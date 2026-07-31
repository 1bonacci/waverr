import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../src/shared/types'
import { QueuePersistence } from '../../src/renderer/audio/queuePersistence'

function makeTrack(id: number, missing = false): Track {
  return {
    id,
    rootId: 1,
    path: `C:/musica/track_${id}.wav`,
    filename: `track_${id}.wav`,
    dir: 'C:/musica',
    folder: 'musica',
    ext: '.wav',
    size: 1000,
    mtime: 0,
    durationMs: 1000,
    title: null,
    artist: null,
    album: null,
    hasTags: false,
    addedAt: 0,
    lastPlayedAt: null,
    playCount: 0,
    missing,
    favorite: false
  }
}

describe('QueuePersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('debounce del guardado', () => {
    it('agrupa varios cambios en una sola escritura', () => {
      const mockSetSetting = vi.fn()
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => null,
        setSetting: mockSetSetting,
        getTrack: async () => null
      })

      // Programar tres guardados seguidos
      persistence.scheduleSave({ manualTracks: [makeTrack(1)], currentTrackId: null })
      persistence.scheduleSave({ manualTracks: [makeTrack(1), makeTrack(2)], currentTrackId: null })
      persistence.scheduleSave({
        manualTracks: [makeTrack(1), makeTrack(2), makeTrack(3)],
        currentTrackId: null
      })

      // Sin avanzar el tiempo, setSetting no se llama
      expect(mockSetSetting).not.toHaveBeenCalled()

      // Avanzar 500ms activa el debounce
      vi.advanceTimersByTime(500)
      expect(mockSetSetting).toHaveBeenCalledOnce()

      // Verificar que se guardo el ultimo estado
      const call = mockSetSetting.mock.calls[0]?.[1]
      if (call) {
        const parsed = JSON.parse(call as string) as { manualTrackIds: number[] }
        expect(parsed.manualTrackIds).toEqual([1, 2, 3])
      }
    })

    it('reinicia el timer si hay cambios durante el debounce', () => {
      const mockSetSetting = vi.fn()
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => null,
        setSetting: mockSetSetting,
        getTrack: async () => null
      })

      persistence.scheduleSave({ manualTracks: [makeTrack(1)], currentTrackId: null })
      vi.advanceTimersByTime(300)

      // Antes de 500ms, otro cambio reinicia el timer
      persistence.scheduleSave({ manualTracks: [makeTrack(1), makeTrack(2)], currentTrackId: null })
      vi.advanceTimersByTime(100)

      // Todavia no se escribio
      expect(mockSetSetting).not.toHaveBeenCalled()

      // Completar los 500ms del segundo cambio
      vi.advanceTimersByTime(400)
      expect(mockSetSetting).toHaveBeenCalledOnce()
    })
  })

  describe('restauracion', () => {
    it('recupera la cola manual guardada', async () => {
      const payload = JSON.stringify({
        manualTrackIds: [1, 2, 3],
        currentTrackId: null
      })
      const mockGetTrack = vi.fn(async (id: number) => makeTrack(id))

      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => payload,
        setSetting: async () => undefined,
        getTrack: mockGetTrack
      })

      const result = await persistence.restore()
      expect(result).not.toBeNull()
      expect(result?.manualTracks.map((t) => t.id)).toEqual([1, 2, 3])
    })

    it('descarta ids inexistentes en silencio', async () => {
      const payload = JSON.stringify({
        manualTrackIds: [1, 999, 2],
        currentTrackId: null
      })
      const mockGetTrack = vi.fn(async (id: number) => (id === 999 ? null : makeTrack(id)))

      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => payload,
        setSetting: async () => undefined,
        getTrack: mockGetTrack
      })

      const result = await persistence.restore()
      expect(result?.manualTracks.map((t) => t.id)).toEqual([1, 2])
    })

    it('descarta tracks marcados como missing', async () => {
      const payload = JSON.stringify({
        manualTrackIds: [1, 2, 3],
        currentTrackId: null
      })
      const mockGetTrack = vi.fn(async (id: number) => makeTrack(id, id === 2))

      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => payload,
        setSetting: async () => undefined,
        getTrack: mockGetTrack
      })

      const result = await persistence.restore()
      expect(result?.manualTracks.map((t) => t.id)).toEqual([1, 3])
    })

    it('no rompe con JSON corrupto', async () => {
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => '{ invalid json }',
        setSetting: async () => undefined,
        getTrack: async () => null
      })

      const result = await persistence.restore()
      expect(result).toBeNull()
    })

    it('es idempotente', async () => {
      const mockGetSetting = vi.fn(async () =>
        JSON.stringify({
          manualTrackIds: [1],
          currentTrackId: null
        })
      )

      const persistence = new QueuePersistence('queue', 500, {
        getSetting: mockGetSetting,
        setSetting: async () => undefined,
        getTrack: async () => makeTrack(1)
      })

      await persistence.restore()
      await persistence.restore()

      // getSetting se llamaria dos veces sin el flag
      expect(mockGetSetting).toHaveBeenCalledTimes(1)
    })

    it('una mutacion durante Promise.all gana sobre lo restaurado', async () => {
      const payload = JSON.stringify({
        manualTrackIds: [1, 2, 3],
        currentTrackId: null
      })

      let callCount = 0
      const mockGetTrack = vi.fn(async (id: number) => {
        callCount++
        // En la segunda llamada a getTrack, simular que la cola fue mutada
        if (callCount === 2) {
          persistence.recordMutation()
        }
        return makeTrack(id)
      })

      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => payload,
        setSetting: async () => undefined,
        getTrack: mockGetTrack
      })

      const result = await persistence.restore()
      // La restauracion no se aplico: la mutacion gano
      expect(result).toBeNull()
    })

    it('una mutacion durante getSetting gana sobre lo restaurado', async () => {
      const payload = JSON.stringify({
        manualTrackIds: [1, 2],
        currentTrackId: null
      })

      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => {
          // Simular que el usuario encola algo mientras getSetting esta en vuelo
          persistence.recordMutation()
          return payload
        },
        setSetting: async () => undefined,
        getTrack: async (id: number) => makeTrack(id)
      })

      const result = await persistence.restore()
      // La restauracion no se aplico: la mutacion durante getSetting gano
      expect(result).toBeNull()
    })

    it('si restore() falla, puede reintentar con la misma instancia', async () => {
      const payload = JSON.stringify({
        manualTrackIds: [1, 2],
        currentTrackId: null
      })

      let shouldFail = true
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => payload,
        setSetting: async () => undefined,
        getTrack: async (id: number) => {
          if (shouldFail && id === 1) throw new Error('IPC error')
          return makeTrack(id)
        }
      })

      // Primer intento falla
      const result1 = await persistence.restore()
      expect(result1).toBeNull()

      // Cambiar para que no falle
      shouldFail = false

      // Segundo intento debe poder restaurar
      const result2 = await persistence.restore()
      expect(result2).not.toBeNull()
      expect(result2?.manualTracks.map((t) => t.id)).toEqual([1, 2])
    })

    it('no reprograma el guardado al restaurar', async () => {
      const mockSetSetting = vi.fn()
      const payload = JSON.stringify({
        manualTrackIds: [1],
        currentTrackId: null
      })

      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => payload,
        setSetting: mockSetSetting,
        getTrack: async () => makeTrack(1)
      })

      await persistence.restore()

      // El timer de guardado no debe estar activo
      vi.advanceTimersByTime(500)
      expect(mockSetSetting).not.toHaveBeenCalled()
    })
  })

  describe('flush al descargar', () => {
    it('escribe lo pendiente cuando se pide flush', () => {
      const mockSetSetting = vi.fn()
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => null,
        setSetting: mockSetSetting,
        getTrack: async () => null
      })

      persistence.scheduleSave({ manualTracks: [makeTrack(1)], currentTrackId: null })

      // Antes de 500ms hay un timer pendiente
      vi.advanceTimersByTime(100)
      expect(mockSetSetting).not.toHaveBeenCalled()

      // Flush escribe inmediatamente
      persistence.flushPendingSave({ manualTracks: [makeTrack(1)], currentTrackId: null })
      expect(mockSetSetting).toHaveBeenCalledOnce()

      // El timer no se llama una segunda vez
      vi.advanceTimersByTime(500)
      expect(mockSetSetting).toHaveBeenCalledOnce()
    })

    it('no hace nada si no hay timer pendiente', () => {
      const mockSetSetting = vi.fn()
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => null,
        setSetting: mockSetSetting,
        getTrack: async () => null
      })

      persistence.flushPendingSave({ manualTracks: [makeTrack(1)], currentTrackId: null })
      expect(mockSetSetting).not.toHaveBeenCalled()
    })
  })
})
