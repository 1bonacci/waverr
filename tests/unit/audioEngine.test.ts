import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../src/shared/types'
import { QueuePersistence } from '../../src/renderer/audio/queuePersistence'

function makeTrack(id: number, missing = false): Track {
  return {
    id,
    rootId: 1,
    path: `C:/music/track_${id}.wav`,
    filename: `track_${id}.wav`,
    dir: 'C:/music',
    folder: 'music',
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
    hidden: false,
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

  describe('save debounce', () => {
    it('groups several changes into a single write', () => {
      const mockSetSetting = vi.fn()
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => null,
        setSetting: mockSetSetting,
        getTrack: async () => null
      })

      // Schedule three saves in a row
      persistence.scheduleSave({ manualTracks: [makeTrack(1)], currentTrackId: null })
      persistence.scheduleSave({ manualTracks: [makeTrack(1), makeTrack(2)], currentTrackId: null })
      persistence.scheduleSave({
        manualTracks: [makeTrack(1), makeTrack(2), makeTrack(3)],
        currentTrackId: null
      })

      // Without advancing time, setSetting is not called
      expect(mockSetSetting).not.toHaveBeenCalled()

      // Advancing 500ms fires the debounce
      vi.advanceTimersByTime(500)
      expect(mockSetSetting).toHaveBeenCalledOnce()

      // Verify the last state was what got saved
      const call = mockSetSetting.mock.calls[0]?.[1]
      if (call) {
        const parsed = JSON.parse(call as string) as { manualTrackIds: number[] }
        expect(parsed.manualTrackIds).toEqual([1, 2, 3])
      }
    })

    it('restarts the timer if there are changes during the debounce', () => {
      const mockSetSetting = vi.fn()
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => null,
        setSetting: mockSetSetting,
        getTrack: async () => null
      })

      persistence.scheduleSave({ manualTracks: [makeTrack(1)], currentTrackId: null })
      vi.advanceTimersByTime(300)

      // Before 500ms, another change restarts the timer
      persistence.scheduleSave({ manualTracks: [makeTrack(1), makeTrack(2)], currentTrackId: null })
      vi.advanceTimersByTime(100)

      // Still not written
      expect(mockSetSetting).not.toHaveBeenCalled()

      // Complete the 500ms of the second change
      vi.advanceTimersByTime(400)
      expect(mockSetSetting).toHaveBeenCalledOnce()
    })
  })

  describe('restoring', () => {
    it('recovers the saved manual queue', async () => {
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

    it('silently discards ids that do not exist', async () => {
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

    it('discards tracks marked as missing', async () => {
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

    it('does not break on corrupt JSON', async () => {
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => '{ invalid json }',
        setSetting: async () => undefined,
        getTrack: async () => null
      })

      const result = await persistence.restore()
      expect(result).toBeNull()
    })

    it('is idempotent', async () => {
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

      // Without the flag, getSetting would be called twice
      expect(mockGetSetting).toHaveBeenCalledTimes(1)
    })

    it('a mutation during Promise.all wins over the restored state', async () => {
      const payload = JSON.stringify({
        manualTrackIds: [1, 2, 3],
        currentTrackId: null
      })

      let callCount = 0
      const mockGetTrack = vi.fn(async (id: number) => {
        callCount++
        // On the second call to getTrack, simulate the queue having been mutated
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
      // The restore was not applied: the mutation won
      expect(result).toBeNull()
    })

    it('a mutation during getSetting wins over the restored state', async () => {
      const payload = JSON.stringify({
        manualTrackIds: [1, 2],
        currentTrackId: null
      })

      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => {
          // Simulates the user queueing something while getSetting is in flight
          persistence.recordMutation()
          return payload
        },
        setSetting: async () => undefined,
        getTrack: async (id: number) => makeTrack(id)
      })

      const result = await persistence.restore()
      // The restore was not applied: the mutation during getSetting won
      expect(result).toBeNull()
    })

    it('if restore() fails, it can be retried with the same instance', async () => {
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

      // First attempt fails
      const result1 = await persistence.restore()
      expect(result1).toBeNull()

      // Make it stop failing
      shouldFail = false

      // Second attempt should be able to restore
      const result2 = await persistence.restore()
      expect(result2).not.toBeNull()
      expect(result2?.manualTracks.map((t) => t.id)).toEqual([1, 2])
    })

    it('does not reschedule the save while restoring', async () => {
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

      // No save timer should be active
      vi.advanceTimersByTime(500)
      expect(mockSetSetting).not.toHaveBeenCalled()
    })
  })

  describe('flush on unload', () => {
    it('writes the pending save when flush is requested', () => {
      const mockSetSetting = vi.fn()
      const persistence = new QueuePersistence('queue', 500, {
        getSetting: async () => null,
        setSetting: mockSetSetting,
        getTrack: async () => null
      })

      persistence.scheduleSave({ manualTracks: [makeTrack(1)], currentTrackId: null })

      // Before 500ms there is a pending timer
      vi.advanceTimersByTime(100)
      expect(mockSetSetting).not.toHaveBeenCalled()

      // Flush writes immediately
      persistence.flushPendingSave({ manualTracks: [makeTrack(1)], currentTrackId: null })
      expect(mockSetSetting).toHaveBeenCalledOnce()

      // The timer is not called a second time
      vi.advanceTimersByTime(500)
      expect(mockSetSetting).toHaveBeenCalledOnce()
    })

    it('does nothing if there is no pending timer', () => {
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
