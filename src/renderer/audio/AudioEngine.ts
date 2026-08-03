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
  skipToManual as skipToManualState,
  type QueueState,
  type QueueView,
  type RepeatMode
} from './playbackQueue'
import { QueuePersistence } from './queuePersistence'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type { RepeatMode } from './playbackQueue'

/** The `settings` key the manual queue is stored under. */
const QUEUE_SETTING_KEY = 'queue'

/** Wait before writing: queueing five tracks in a row produces one write, not
 *  five. */
const SAVE_DEBOUNCE_MS = 500

export interface PlaybackState {
  track: Track | null
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  /** How many tracks the user queued by hand. */
  manualCount: number
  /** How many are left of the context after the current one. */
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

/** Before this point, PREV restarts the track instead of going to the previous
 *  one (like a real MP3 player). */
const RESTART_THRESHOLD_MS = 3000

const FFT_SIZE = 2048

/**
 * The playback engine.
 *
 * Deliberately lives outside React: the AudioContext and the <audio> element
 * have to survive any re-render. React subscribes with `useSyncExternalStore`
 * and only reads.
 */
export class AudioEngine {
  private readonly audio: HTMLAudioElement
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private gain: GainNode | null = null

  private queue: QueueState = EMPTY_QUEUE

  private state: PlaybackState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()

  private persistence: QueuePersistence

  constructor() {
    this.persistence = new QueuePersistence(QUEUE_SETTING_KEY, SAVE_DEBOUNCE_MS)

    this.audio = new Audio()
    this.audio.preload = 'metadata'
    // Without this the analyser node is tainted and the visualizer sees zeros.
    this.audio.crossOrigin = 'anonymous'
    this.audio.volume = INITIAL_STATE.volume

    // The real event order is play -> waiting -> canplay -> playing.
    // `playing` is the only one that guarantees audio is actually coming out:
    // without listening for it, the state stays stuck at "loading" forever.
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
      // The index's duration wins: for long WAVs the element sometimes reports
      // Infinity until it has finished buffering.
      this.patch({ durationMs: this.state.track?.durationMs ?? fromFile ?? 0 })
    })

    this.persistence.setupUnloadHandler(() => this.flushPendingSave())
  }

  // --- Subscription (useSyncExternalStore) -------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): PlaybackState => this.state

  // --- Queue ----------------------------------------------------------------

  /**
   * Replaces the context and starts at `startIndex`.
   *
   * The manual queue is untouched: whatever the user queued on purpose still
   * plays after this.
   */
  async playNow(tracks: Track[], startIndex = 0): Promise<void> {
    const wasPlaying = this.state.track
    this.queue = playNowState(this.queue, tracks, startIndex)

    // Selecting the track that is already loaded means "take me to it", not
    // "start it over": reloading would throw away the position someone is
    // several minutes into. The context is still replaced above, so NEXT
    // follows the list they picked it from either way.
    if (wasPlaying && this.queue.current?.id === wasPlaying.id) {
      this.publishQueue()
      return
    }

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

  /**
   * Jumps straight to a track in the manual queue. The ones ahead of it are not
   * lost: they stay there, ready to play afterwards.
   */
  async skipToManual(index: number): Promise<void> {
    const nextQueue = skipToManualState(this.queue, index)
    if (nextQueue === this.queue) return
    this.queue = nextQueue
    await this.loadCurrent()
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
    // `advance` with repeat 'one' returns the same state: restarting is
    // handleEnded's job, not that of an explicit NEXT from the user.
    const nextState = advance(this.queue, this.state.repeat === 'one' ? 'off' : this.state.repeat)
    if (!nextState) {
      this.pause()
      return
    }
    this.queue = nextState
    await this.loadCurrent()
  }

  /** Like a real MP3 player: once it has played a little, PREV restarts the
   *  track. */
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

  // --- Analysis for the visualizer ---------------------------------------

  /** Returns the analyser node, creating the AudioContext if necessary. */
  getAnalyser(): AnalyserNode | null {
    this.ensureContext()
    return this.analyser
  }

  // --- Interno -----------------------------------------------------------

  /**
   * Creates the AudioContext on the user's first real gesture.
   *
   * Chromium blocks contexts created before an interaction, so doing it in the
   * constructor would leave the visualizer mute until a resume.
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

  /** Loads into the <audio> element whatever the model says is playing now. */
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

  /** Mirrors the queue counts into the observable state. */
  private publishQueue(): void {
    const view = queueView(this.queue)
    this.patch({ manualCount: view.manual.length, upcomingCount: view.upcoming.length })
    this.persistence.recordMutation()
    this.persistence.scheduleSave({
      manualTracks: this.queue.manual,
      currentTrackId: this.queue.current?.id ?? null
    })
  }

  /**
   * Recovers the manual queue from the previous session.
   *
   * The context is not saved: it was the view you were looking at, and on
   * reopening the app that view no longer exists. Ids that are no longer in the
   * index are discarded silently.
   *
   * Idempotent: React mounts twice under StrictMode, and this restores only
   * once. If the queue was mutated during the restore, the mutation wins.
   */
  async restore(): Promise<void> {
    const restored = await this.persistence.restore()
    if (!restored) return

    this.queue = { ...this.queue, manual: restored.manualTracks }
    // Published without rescheduling the save: restoring is not a change.
    const view = queueView(this.queue)
    this.patch({ manualCount: view.manual.length, upcomingCount: view.upcoming.length })
  }

  private flushPendingSave(): void {
    this.persistence.flushPendingSave({
      manualTracks: this.queue.manual,
      currentTrackId: this.queue.current?.id ?? null
    })
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
        ? 'Unsupported format'
        : code === MediaError.MEDIA_ERR_DECODE
          ? 'Corrupt file'
          : 'Read error'
    this.patch({ status: 'error', error: message })
  }

  private patch(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) listener()
  }
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Playback blocked'
  }
  return error instanceof Error ? error.message : 'Error'
}

/** Instancia unica de la app. */
export const audioEngine = new AudioEngine()
