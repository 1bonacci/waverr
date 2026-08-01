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
 * Encapsula la logica de persistencia de la cola manual.
 * Independiente de AudioEngine para poder testear sin dependencias del DOM.
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
      // Limpiar antes de guardar: si no, `flushPendingSave` (disparado por
      // `pagehide` justo cuando este timeout ya corrio) ve un timer que cree
      // pendiente y reescribe un payload que ya se persistio.
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

    // Capturar el contador COMO PRIMERA COSA, antes de cualquier await.
    // Asi detecta mutaciones incluso durante getSetting.
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

      // Paralelo: reduce la ventana donde puede ocurrir una mutacion.
      const fetchedTracks = await Promise.all(
        ids.map((id) => this.callbacks.getTrack(id))
      )

      const tracks: Track[] = []
      for (const track of fetchedTracks) {
        if (track && !track.missing) tracks.push(track)
      }

      // Si la cola fue mutada mientras restaurabamos, el usuario gano: descartar.
      if (this.mutationCount !== mutationCountAtStart) {
        return null
      }

      // Chequear el tipo primero para evitar tratar 0 como falsy.
      const currentTrackId = typeof parsed.currentTrackId === 'number'
        ? parsed.currentTrackId
        : null

      return {
        manualTracks: tracks,
        currentTrackId
      }
    } catch (error) {
      // Capturar excepciones para no propagar hacia void audioEngine.restore().
      // No romper el arranque; registrar y permitir reintentos.
      console.error('QueuePersistence.restore() fallo:', error)
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
    // Best-effort: IPC es asincronico, sin garantia de que complete al cerrar.
    void this.callbacks.setSetting(this.key, payload)
  }

  setupUnloadHandler(onFlush: () => void): void {
    window.addEventListener('pagehide', onFlush)
  }
}
