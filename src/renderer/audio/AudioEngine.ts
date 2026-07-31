import { mediaUrlForTrack } from '@shared/media'
import type { Track } from '@shared/types'
import {
  advance,
  EMPTY_QUEUE,
  enqueue as enqueueTrack,
  enqueueNext as enqueueNextTrack,
  move as moveInQueueState,
  playNow as playNowState,
  previous as previousState,
  queueView,
  removeAt,
  setShuffle as setShuffleState,
  type QueueState,
  type QueueView,
  type RepeatMode
} from './playbackQueue'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type { RepeatMode } from './playbackQueue'

/** Clave de `settings` donde se guarda la cola manual. */
const QUEUE_SETTING_KEY = 'queue'

/** Espera antes de escribir: encolar cinco temas seguidos hace una sola
 *  escritura, no cinco. */
const SAVE_DEBOUNCE_MS = 500

export interface PlaybackState {
  track: Track | null
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  /** Cuantas pistas encolo el usuario a mano. */
  manualCount: number
  /** Cuantas quedan del contexto despues de la actual. */
  upcomingCount: number
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
  manualCount: 0,
  upcomingCount: 0,
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

  private queue: QueueState = EMPTY_QUEUE

  private state: PlaybackState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()

  private saveTimer: ReturnType<typeof setTimeout> | null = null

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

  // --- Cola -----------------------------------------------------------------

  /**
   * Reemplaza el contexto y arranca en `startIndex`.
   *
   * La cola manual no se toca: lo que el usuario encolo a proposito sigue
   * sonando despues de esto.
   */
  async playNow(tracks: Track[], startIndex = 0): Promise<void> {
    this.queue = playNowState(this.queue, tracks, startIndex)
    await this.loadCurrent()
  }

  enqueue(track: Track): void {
    this.queue = enqueueTrack(this.queue, track)
    this.publishQueue()
  }

  enqueueNext(track: Track): void {
    this.queue = enqueueNextTrack(this.queue, track)
    this.publishQueue()
  }

  removeFromQueue(index: number): void {
    this.queue = removeAt(this.queue, index)
    this.publishQueue()
  }

  moveInQueue(from: number, to: number): void {
    this.queue = moveInQueueState(this.queue, from, to)
    this.publishQueue()
  }

  getQueueView(): QueueView {
    return queueView(this.queue)
  }

  clearQueue(): void {
    this.queue = EMPTY_QUEUE
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.patch({ ...INITIAL_STATE, volume: this.state.volume })
  }

  // --- Transporte -------------------------------------------------------

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
    // `advance` con repeat 'one' devuelve el mismo estado: reiniciar es
    // responsabilidad de handleEnded, no de un NEXT explicito del usuario.
    const nextState = advance(this.queue, this.state.repeat === 'one' ? 'off' : this.state.repeat)
    if (!nextState) {
      this.pause()
      return
    }
    this.queue = nextState
    await this.loadCurrent()
  }

  /** Como un MP3 de verdad: si ya avanzo un poco, PREV reinicia la pista. */
  async previous(): Promise<void> {
    if (this.state.positionMs > RESTART_THRESHOLD_MS) {
      this.seek(0)
      return
    }
    const previousQueue = previousState(this.queue)
    if (!previousQueue) {
      this.seek(0)
      return
    }
    this.queue = previousQueue
    await this.loadCurrent()
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume))
    this.audio.volume = clamped
    this.patch({ volume: clamped })
  }

  setShuffle(shuffle: boolean): void {
    this.queue = setShuffleState(this.queue, shuffle)
    this.patch({ shuffle })
    this.publishQueue()
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

  /** Carga en el elemento <audio> lo que el modelo dice que suena ahora. */
  private async loadCurrent(): Promise<void> {
    const track = this.queue.current
    if (!track) {
      this.patch({ track: null, status: 'idle' })
      return
    }

    this.patch({
      track,
      status: 'loading',
      positionMs: 0,
      durationMs: track.durationMs ?? 0,
      error: null
    })
    this.publishQueue()

    this.audio.src = mediaUrlForTrack(track.id)
    this.audio.load()
    await this.play()
  }

  /** Refleja en el estado observable los conteos de la cola. */
  private publishQueue(): void {
    const view = queueView(this.queue)
    this.patch({ manualCount: view.manual.length, upcomingCount: view.upcoming.length })
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const payload = JSON.stringify({
        manualTrackIds: this.queue.manual.map((track) => track.id),
        currentTrackId: this.queue.current?.id ?? null
      })
      void window.waverr.library.setSetting(QUEUE_SETTING_KEY, payload)
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Recupera la cola manual de la sesion anterior.
   *
   * El contexto no se guarda: era la vista que estabas mirando y al reabrir la
   * app esa vista ya no existe. Los ids que ya no estan en el indice se
   * descartan en silencio.
   */
  async restore(): Promise<void> {
    const raw = await window.waverr.library.getSetting(QUEUE_SETTING_KEY)
    if (!raw) return

    let parsed: { manualTrackIds?: unknown; currentTrackId?: unknown }
    try {
      parsed = JSON.parse(raw) as typeof parsed
    } catch {
      return
    }

    const ids = Array.isArray(parsed.manualTrackIds)
      ? parsed.manualTrackIds.filter((id): id is number => typeof id === 'number')
      : []

    const tracks: Track[] = []
    for (const id of ids) {
      const track = await window.waverr.library.getTrack(id)
      if (track && !track.missing) tracks.push(track)
    }

    this.queue = { ...this.queue, manual: tracks }
    // Se publica sin reprogramar el guardado: restaurar no es un cambio.
    const view = queueView(this.queue)
    this.patch({ manualCount: view.manual.length, upcomingCount: view.upcoming.length })
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

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'REPRODUCCION BLOQUEADA'
  }
  return error instanceof Error ? error.message.toUpperCase() : 'ERROR'
}

/** Instancia unica de la app. */
export const audioEngine = new AudioEngine()
