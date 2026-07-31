import { mediaUrlForTrack } from '@shared/media'
import type { Track } from '@shared/types'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type RepeatMode = 'off' | 'one' | 'all'

export interface PlaybackState {
  track: Track | null
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  queueLength: number
  queueIndex: number
  error: string | null
}

const INITIAL_STATE: PlaybackState = {
  track: null,
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
  queueLength: 0,
  queueIndex: -1,
  error: null
}

/** Antes de esto, PREV reinicia la pista en lugar de ir a la anterior (como un MP3 real). */
const RESTART_THRESHOLD_MS = 3000

const FFT_SIZE = 2048

/**
 * Motor de reproduccion.
 *
 * Vive fuera de React a proposito: el AudioContext y el elemento <audio> tienen
 * que sobrevivir a cualquier re-render. React se suscribe con
 * `useSyncExternalStore` y solo lee.
 */
export class AudioEngine {
  private readonly audio: HTMLAudioElement
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private gain: GainNode | null = null

  private queue: Track[] = []
  /** Orden real de reproduccion: con shuffle es una permutacion de los indices de `queue`. */
  private order: number[] = []
  private orderPosition = -1

  private state: PlaybackState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'metadata'
    // Sin esto el nodo de analisis queda "tainted" y el visualizador ve ceros.
    this.audio.crossOrigin = 'anonymous'
    this.audio.volume = INITIAL_STATE.volume

    // El orden real de eventos es play -> waiting -> canplay -> playing.
    // `playing` es el unico que garantiza que ya esta saliendo audio: sin
    // escucharlo, el estado se queda clavado en "loading" para siempre.
    this.audio.addEventListener('play', () => {
      this.patch({ status: this.audio.readyState >= 3 ? 'playing' : 'loading', error: null })
    })
    this.audio.addEventListener('playing', () => this.patch({ status: 'playing', error: null }))
    this.audio.addEventListener('pause', () => {
      if (!this.audio.ended) this.patch({ status: 'paused' })
    })
    this.audio.addEventListener('waiting', () => this.patch({ status: 'loading' }))
    this.audio.addEventListener('ended', () => this.handleEnded())
    this.audio.addEventListener('error', () => this.handleError())
    this.audio.addEventListener('timeupdate', () => {
      this.patch({ positionMs: this.audio.currentTime * 1000 })
    })
    this.audio.addEventListener('loadedmetadata', () => {
      const fromFile = Number.isFinite(this.audio.duration) ? this.audio.duration * 1000 : 0
      // La duracion del indice gana: para WAV largos el elemento a veces
      // reporta Infinity hasta que termina de bufferear.
      this.patch({ durationMs: this.state.track?.durationMs ?? fromFile ?? 0 })
    })
  }

  // --- Suscripcion (useSyncExternalStore) --------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): PlaybackState => this.state

  // --- Cola --------------------------------------------------------------

  /**
   * Reemplaza la cola y arranca en `startIndex`.
   *
   * Es la unica forma de empezar a sonar: hasta la busqueda "reproducir esta"
   * manda la lista de resultados como cola, para que NEXT tenga sentido.
   */
  async setQueue(tracks: Track[], startIndex = 0): Promise<void> {
    this.queue = tracks
    this.rebuildOrder(startIndex)
    await this.playAtOrderPosition(this.orderPosition)
  }

  clearQueue(): void {
    this.queue = []
    this.order = []
    this.orderPosition = -1
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.patch({ ...INITIAL_STATE, volume: this.state.volume })
  }

  // --- Transporte --------------------------------------------------------

  async play(): Promise<void> {
    if (!this.state.track) return
    this.ensureContext()
    try {
      await this.audio.play()
    } catch (error) {
      this.patch({ status: 'error', error: describeError(error) })
    }
  }

  pause(): void {
    this.audio.pause()
  }

  async toggle(): Promise<void> {
    if (this.state.status === 'playing') this.pause()
    else await this.play()
  }

  seek(positionMs: number): void {
    if (!this.state.track) return
    const max = this.state.durationMs || this.audio.duration * 1000 || 0
    const clamped = Math.max(0, Math.min(positionMs, max))
    this.audio.currentTime = clamped / 1000
    this.patch({ positionMs: clamped })
  }

  async next(): Promise<void> {
    if (this.order.length === 0) return

    if (this.orderPosition >= this.order.length - 1) {
      if (this.state.repeat === 'all') return this.playAtOrderPosition(0)
      this.pause()
      return
    }
    await this.playAtOrderPosition(this.orderPosition + 1)
  }

  /** Como un MP3 de verdad: si ya avanzo un poco, PREV reinicia la pista. */
  async previous(): Promise<void> {
    if (this.state.positionMs > RESTART_THRESHOLD_MS) {
      this.seek(0)
      return
    }
    if (this.orderPosition <= 0) {
      this.seek(0)
      return
    }
    await this.playAtOrderPosition(this.orderPosition - 1)
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume))
    this.audio.volume = clamped
    this.patch({ volume: clamped })
  }

  setShuffle(shuffle: boolean): void {
    if (shuffle === this.state.shuffle) return
    this.patch({ shuffle })
    // Se reconstruye el orden manteniendo la pista actual donde esta parada.
    const currentIndex = this.order[this.orderPosition] ?? 0
    this.rebuildOrder(currentIndex)
  }

  cycleRepeat(): RepeatMode {
    const next: RepeatMode =
      this.state.repeat === 'off' ? 'all' : this.state.repeat === 'all' ? 'one' : 'off'
    this.patch({ repeat: next })
    return next
  }

  // --- Analisis para el visualizador -------------------------------------

  /** Devuelve el nodo de analisis, creando el AudioContext si hace falta. */
  getAnalyser(): AnalyserNode | null {
    this.ensureContext()
    return this.analyser
  }

  // --- Interno -----------------------------------------------------------

  /**
   * Crea el AudioContext en el primer gesto real del usuario.
   *
   * Chromium bloquea los contextos creados antes de una interaccion, asi que
   * hacerlo en el constructor dejaria el visualizador mudo hasta un resume.
   */
  private ensureContext(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume()
      return
    }

    const context = new AudioContext()
    const source = context.createMediaElementSource(this.audio)
    const gain = context.createGain()
    const analyser = context.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = 0.75

    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(context.destination)

    this.context = context
    this.gain = gain
    this.analyser = analyser
  }

  private rebuildOrder(startIndex: number): void {
    const indices = this.queue.map((_, index) => index)

    if (!this.state.shuffle) {
      this.order = indices
      this.orderPosition = clampIndex(startIndex, indices.length)
      return
    }

    const rest = indices.filter((index) => index !== startIndex)
    shuffleInPlace(rest)
    this.order = startIndex >= 0 && startIndex < indices.length ? [startIndex, ...rest] : rest
    this.orderPosition = this.order.length > 0 ? 0 : -1
  }

  private async playAtOrderPosition(position: number): Promise<void> {
    if (position < 0 || position >= this.order.length) return

    const queueIndex = this.order[position]
    if (queueIndex === undefined) return
    const track = this.queue[queueIndex]
    if (!track) return

    this.orderPosition = position
    this.patch({
      track,
      status: 'loading',
      positionMs: 0,
      durationMs: track.durationMs ?? 0,
      queueLength: this.queue.length,
      queueIndex,
      error: null
    })

    this.audio.src = mediaUrlForTrack(track.id)
    this.audio.load()
    await this.play()
  }

  private handleEnded(): void {
    if (this.state.repeat === 'one') {
      this.seek(0)
      void this.play()
      return
    }
    void this.next()
  }

  private handleError(): void {
    const code = this.audio.error?.code
    const message =
      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'FORMATO NO SOPORTADO'
        : code === MediaError.MEDIA_ERR_DECODE
          ? 'ARCHIVO CORRUPTO'
          : 'ERROR DE LECTURA'
    this.patch({ status: 'error', error: message })
  }

  private patch(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) listener()
  }
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return -1
  return Math.max(0, Math.min(index, length - 1))
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = items[i]!
    const b = items[j]!
    items[i] = b
    items[j] = a
  }
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'REPRODUCCION BLOQUEADA'
  }
  return error instanceof Error ? error.message.toUpperCase() : 'ERROR'
}

/** Instancia unica de la app. */
export const audioEngine = new AudioEngine()
