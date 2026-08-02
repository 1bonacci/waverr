import type { Track } from '@shared/types'

export interface QueuePersistenceState {
  manualTracks: Track[]
  currentTrackId: number | null
}

export interface QueuePersistenceCallbacks {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  getTrack(id: number): Promise<Track | null>
}

/**
 * Wraps the persistence logic for the manual queue.
 *
 * Kept separate from AudioEngine so it can be tested with no DOM dependencies.
 */
export class QueuePersistence {
  private readonly key: string
  private readonly debounceMs: number
  private readonly callbacks: QueuePersistenceCallbacks

  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private mutationCount = 0
  private restored = false

  constructor(
    key: string = 'queue',
    debounceMs: number = 500,
    callbacks: QueuePersistenceCallbacks | null = null
  ) {
    this.key = key
    this.debounceMs = debounceMs
    this.callbacks = callbacks || {
      getSetting: async (k: string) => window.waverr.library.getSetting(k),
      setSetting: async (k: string, v: string) => window.waverr.library.setSetting(k, v),
      getTrack: async (id: number) => window.waverr.library.getTrack(id)
    }
  }

  scheduleSave(state: QueuePersistenceState): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      // Cleared before saving: otherwise `flushPendingSave` (fired by
      // `pagehide` just as this timeout has already run) sees a timer it
      // believes is pending and rewrites a payload that was already persisted.
      this.saveTimer = null
      const payload = JSON.stringify({
        manualTrackIds: state.manualTracks.map((t) => t.id),
        currentTrackId: state.currentTrackId
      })
      void this.callbacks.setSetting(this.key, payload)
    }, this.debounceMs)
  }

  recordMutation(): void {
    this.mutationCount++
  }

  async restore(): Promise<QueuePersistenceState | null> {
    if (this.restored) return null

    // Capture the counter AS THE VERY FIRST THING, before any await, so that
    // mutations during getSetting are detected too.
    const mutationCountAtStart = this.mutationCount

    try {
      this.restored = true

      const raw = await this.callbacks.getSetting(this.key)
      if (!raw) return null

      let parsed: { manualTrackIds?: unknown; currentTrackId?: unknown }
      try {
        parsed = JSON.parse(raw) as typeof parsed
      } catch {
        return null
      }

      const ids = Array.isArray(parsed.manualTrackIds)
        ? parsed.manualTrackIds.filter((id): id is number => typeof id === 'number')
        : []

      // In parallel: narrows the window in which a mutation can happen.
      const fetchedTracks = await Promise.all(
        ids.map((id) => this.callbacks.getTrack(id))
      )

      const tracks: Track[] = []
      for (const track of fetchedTracks) {
        if (track && !track.missing) tracks.push(track)
      }

      // If the queue was mutated while restoring, the user wins: discard.
      if (this.mutationCount !== mutationCountAtStart) {
        return null
      }

      // Check the type first, so a legitimate 0 is not treated as falsy.
      const currentTrackId = typeof parsed.currentTrackId === 'number'
        ? parsed.currentTrackId
        : null

      return {
        manualTracks: tracks,
        currentTrackId
      }
    } catch (error) {
      // Caught so nothing propagates out of `void audioEngine.restore()`.
      // Startup must not break; log it and allow a retry.
      console.error('QueuePersistence.restore() failed:', error)
      this.restored = false
      return null
    }
  }

  flushPendingSave(state: QueuePersistenceState): void {
    if (this.saveTimer === null) return

    clearTimeout(this.saveTimer)
    this.saveTimer = null

    const payload = JSON.stringify({
      manualTrackIds: state.manualTracks.map((t) => t.id),
      currentTrackId: state.currentTrackId
    })
    // Best effort: IPC is asynchronous, with no guarantee it completes on close.
    void this.callbacks.setSetting(this.key, payload)
  }

  setupUnloadHandler(onFlush: () => void): void {
    window.addEventListener('pagehide', onFlush)
  }
}
