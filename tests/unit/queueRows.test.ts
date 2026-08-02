import { describe, expect, it } from 'vitest'
import type { Track } from '../../src/shared/types'
import {
  buildQueueRows,
  isMovableRow,
  manualIndexForDrop,
  occurrenceInManual,
  resolveManualIndexById,
  type QueueRow
} from '../../src/renderer/screen/queueRows'

function makeTrack(id: number, filename = `track_${id}.wav`): Track {
  return {
    id,
    rootId: 1,
    path: `C:/music/${filename}`,
    filename,
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
    missing: false,
    favorite: false
  }
}

const [now, m0, m1, m2, u0, u1] = [
  makeTrack(1, 'now.wav'),
  makeTrack(2, 'm0.wav'),
  makeTrack(3, 'm1.wav'),
  makeTrack(4, 'm2.wav'),
  makeTrack(5, 'u0.wav'),
  makeTrack(6, 'u1.wav')
] as [Track, Track, Track, Track, Track, Track]

describe('buildQueueRows', () => {
  it('with a NOW row, puts NOW first and then interleaves manual and upcoming in order', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [u0] })
    expect(rows).toEqual<QueueRow[]>([
      { section: 'now', track: now },
      { section: 'manual', track: m0, manualIndex: 0 },
      { section: 'manual', track: m1, manualIndex: 1 },
      { section: 'upcoming', track: u0, upcomingIndex: 0 }
    ])
  })

  it('with nothing playing, there is no NOW row', () => {
    const rows = buildQueueRows({ now: null, manual: [m0], upcoming: [u0] })
    expect(rows[0]).toEqual({ section: 'manual', track: m0, manualIndex: 0 })
    expect(rows.some((row) => row.section === 'now')).toBe(false)
  })

  it('with an empty manual queue, no manual row appears', () => {
    const rows = buildQueueRows({ now, manual: [], upcoming: [u0, u1] })
    expect(rows.filter((row) => row.section === 'manual')).toHaveLength(0)
    expect(rows).toEqual<QueueRow[]>([
      { section: 'now', track: now },
      { section: 'upcoming', track: u0, upcomingIndex: 0 },
      { section: 'upcoming', track: u1, upcomingIndex: 1 }
    ])
  })
})

describe('isMovableRow', () => {
  it('a LATER row can never be moved', () => {
    const rows = buildQueueRows({ now, manual: [m0], upcoming: [u0, u1] })
    const upcomingRows = rows.filter((row) => row.section === 'upcoming')
    expect(upcomingRows.length).toBeGreaterThan(0)
    for (const row of upcomingRows) expect(isMovableRow(row)).toBe(false)
  })

  it('the NOW row cannot be moved either', () => {
    const rows = buildQueueRows({ now, manual: [m0], upcoming: [] })
    const nowRow = rows[0]!
    expect(nowRow.section).toBe('now')
    expect(isMovableRow(nowRow)).toBe(false)
  })

  it('manual queue rows can be moved', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [] })
    const manualRows = rows.filter((row) => row.section === 'manual')
    expect(manualRows).toHaveLength(2)
    for (const row of manualRows) expect(isMovableRow(row)).toBe(true)
  })
})

describe('manualIndexForDrop', () => {
  it('with a NOW row, the first manual row translates to index 0', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1, m2], upcoming: [] })
    // Row 0 is NOW, row 1 is the first manual one.
    expect(manualIndexForDrop(rows, 1)).toBe(0)
  })

  it('with a NOW row, the last manual row translates to its real index', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1, m2], upcoming: [] })
    // Row 3 is the last manual one (NOW + 3 manual, row indices 1..3).
    expect(manualIndexForDrop(rows, 3)).toBe(2)
  })

  it('with no NOW row, the first and last manual rows translate directly', () => {
    const rows = buildQueueRows({ now: null, manual: [m0, m1, m2], upcoming: [] })
    expect(manualIndexForDrop(rows, 0)).toBe(0)
    expect(manualIndexForDrop(rows, 2)).toBe(2)
  })

  it('dropping on the NOW row means the head of the manual queue', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [] })
    expect(manualIndexForDrop(rows, 0)).toBe(0)
  })

  it('dropping on a LATER row means the tail of the manual queue', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [u0] })
    // Row 3 (indices 0,1,2,3 -> NOW, m0, m1, u0) is the LATER one.
    expect(manualIndexForDrop(rows, 3)).toBe(2)
  })

  it('with an empty manual queue, any row translates to index 0', () => {
    const rows = buildQueueRows({ now, manual: [], upcoming: [u0] })
    expect(manualIndexForDrop(rows, 0)).toBe(0)
    expect(manualIndexForDrop(rows, 1)).toBe(0)
  })

  it('an out-of-range row index falls back to the tail of the manual queue', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [] })
    expect(manualIndexForDrop(rows, 99)).toBe(2)
    expect(manualIndexForDrop(rows, -1)).toBe(2)
  })
})

describe('occurrenceInManual', () => {
  it('with no duplicates, every row is occurrence 0', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1, m2], upcoming: [] })
    expect(occurrenceInManual(rows, 0)).toBe(0)
    expect(occurrenceInManual(rows, 1)).toBe(0)
    expect(occurrenceInManual(rows, 2)).toBe(0)
  })

  it('with a repeated track, counts which copy it is', () => {
    // Manual queue [X, Y, X]: queueing the same track twice is allowed on
    // purpose (enqueue does not deduplicate).
    const rows = buildQueueRows({ now: null, manual: [m0, m1, m0], upcoming: [] })
    expect(occurrenceInManual(rows, 0)).toBe(0) // first copy of m0
    expect(occurrenceInManual(rows, 1)).toBe(0) // m1, no duplicates
    expect(occurrenceInManual(rows, 2)).toBe(1) // second copy of m0
  })

  it('with a track repeated three times, counts all three occurrences', () => {
    const rows = buildQueueRows({ now: null, manual: [m0, m0, m0], upcoming: [] })
    expect(occurrenceInManual(rows, 0)).toBe(0)
    expect(occurrenceInManual(rows, 1)).toBe(1)
    expect(occurrenceInManual(rows, 2)).toBe(2)
  })
})

describe('resolveManualIndexById', () => {
  it('with no duplicates, resolves by trackId and the occurrence changes nothing', () => {
    // State when the row was grabbed: NOW=now, MANUAL=[m0, m1, m2]. m2 is grabbed.
    const before = buildQueueRows({ now, manual: [m0, m1, m2], upcoming: [] })
    expect(resolveManualIndexById(before, m2.id, occurrenceInManual(before, 2))).toBe(2)

    // While dragging, the track that was playing ends: m0 is consumed
    // (becomes NOW) and the manual queue gets shorter. m2's row index changed
    // (from 3 to 2 with NOW present), but its identity still resolves to the
    // right manual index.
    const after = buildQueueRows({ now: m0, manual: [m1, m2], upcoming: [] })
    expect(resolveManualIndexById(after, m2.id, 0)).toBe(1)
  })

  it('if the grabbed track was consumed on its own, there is nowhere to resolve it', () => {
    const rows = buildQueueRows({ now: m0, manual: [m1, m2], upcoming: [] })
    expect(resolveManualIndexById(rows, m0.id, 0)).toBeNull()
  })

  // Regression: with the manual queue at [X, Y, X], grabbing the third row
  // (the second copy of X) and dropping it always resolved to the FIRST match
  // by trackId (index 0), moving the wrong copy. Queueing the same track twice
  // is allowed on purpose, so the tie has to be broken by occurrence, not just
  // by trackId.
  describe('with a repeated track, breaks the tie by occurrence', () => {
    it('a queue with no duplicates: nothing changes', () => {
      const rows = buildQueueRows({ now: null, manual: [m0, m1, m2], upcoming: [] })
      expect(resolveManualIndexById(rows, m1.id, 0)).toBe(1)
    })

    it('[X, Y, X]: grabbing the first copy of X resolves to index 0', () => {
      const rows = buildQueueRows({ now: null, manual: [m0, m1, m0], upcoming: [] })
      expect(resolveManualIndexById(rows, m0.id, 0)).toBe(0)
    })

    it('[X, Y, X]: grabbing the second copy of X resolves to index 2, not 0', () => {
      const rows = buildQueueRows({ now: null, manual: [m0, m1, m0], upcoming: [] })
      expect(resolveManualIndexById(rows, m0.id, 1)).toBe(2)
    })

    it('a track repeated three times: each occurrence resolves to its own index', () => {
      const rows = buildQueueRows({ now: null, manual: [m0, m0, m0], upcoming: [] })
      expect(resolveManualIndexById(rows, m0.id, 0)).toBe(0)
      expect(resolveManualIndexById(rows, m0.id, 1)).toBe(1)
      expect(resolveManualIndexById(rows, m0.id, 2)).toBe(2)
    })

    it('if an earlier copy was consumed on its own, falls back to the last copy left', () => {
      // The third row of [X, Y, X] was grabbed (occurrence 1). While dragging,
      // the first copy of X started playing (NOW) and left the manual queue:
      // now only one copy is left, the one that was grabbed.
      const rows = buildQueueRows({ now: m0, manual: [m1, m0], upcoming: [] })
      expect(resolveManualIndexById(rows, m0.id, 1)).toBe(1)
    })
  })
})
