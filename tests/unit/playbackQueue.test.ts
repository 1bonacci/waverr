import { describe, expect, it } from 'vitest'
import type { Track } from '../../src/shared/types'
import {
  advance,
  EMPTY_QUEUE,
  enqueue,
  enqueueNext,
  move,
  playNow,
  previous,
  queueView,
  removeAt,
  setShuffle,
  skipToManual
} from '../../src/renderer/audio/playbackQueue'

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

const [a, b, c, d] = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)]

describe('playNow', () => {
  it('starts playing the chosen track from the context', () => {
    const state = playNow(EMPTY_QUEUE, [a, b, c], 1)
    expect(state.current).toBe(b)
    expect(queueView(state).upcoming).toEqual([c])
  })

  it('does not clear the manual queue', () => {
    const withManual = enqueue(EMPTY_QUEUE, d)
    const state = playNow(withManual, [a, b, c], 0)
    expect(state.manual).toEqual([d])
  })

  it('an out-of-range index does not break', () => {
    const state = playNow(EMPTY_QUEUE, [a, b], 99)
    expect(state.current).toBe(b)
  })

  it('an empty context leaves everything untouched', () => {
    const state = playNow(EMPTY_QUEUE, [], 0)
    expect(state.current).toBeNull()
    expect(queueView(state).upcoming).toEqual([])
  })
})

describe('queueing', () => {
  it('enqueue adds to the end', () => {
    const state = enqueue(enqueue(EMPTY_QUEUE, a), b)
    expect(state.manual).toEqual([a, b])
  })

  it('enqueueNext adds to the front', () => {
    const state = enqueueNext(enqueue(EMPTY_QUEUE, a), b)
    expect(state.manual).toEqual([b, a])
  })

  it('allows the same track twice', () => {
    const state = enqueue(enqueue(EMPTY_QUEUE, a), a)
    expect(state.manual).toHaveLength(2)
  })
})

describe('advance', () => {
  it('consumes the manual queue first', () => {
    const state = enqueue(playNow(EMPTY_QUEUE, [a, b, c], 0), d)
    const next = advance(state, 'off')!
    expect(next.current).toBe(d)
    expect(next.manual).toEqual([])
  })

  it('once the manual queue is empty, continues the context where it was', () => {
    let state = enqueue(playNow(EMPTY_QUEUE, [a, b, c], 0), d)
    state = advance(state, 'off')!
    state = advance(state, 'off')!
    expect(state.current).toBe(b)
  })

  it('returns null at the end of the context', () => {
    const state = playNow(EMPTY_QUEUE, [a, b], 1)
    expect(advance(state, 'off')).toBeNull()
  })

  it('with repeat all, goes back to the start of the context', () => {
    const state = playNow(EMPTY_QUEUE, [a, b], 1)
    expect(advance(state, 'all')!.current).toBe(a)
  })

  it('with repeat one, consumes nothing', () => {
    const state = enqueue(playNow(EMPTY_QUEUE, [a, b], 0), d)
    const next = advance(state, 'one')!
    expect(next.current).toBe(a)
    expect(next.manual).toEqual([d])
  })
})

describe('previous', () => {
  it('steps back within the context', () => {
    const state = playNow(EMPTY_QUEUE, [a, b, c], 2)
    expect(previous(state)!.current).toBe(b)
  })

  it('returns null on the first track', () => {
    const state = playNow(EMPTY_QUEUE, [a, b], 0)
    expect(previous(state)).toBeNull()
  })
})

describe('shuffle', () => {
  it('shuffles the context but leaves the manual queue untouched', () => {
    const context = Array.from({ length: 30 }, (_, index) => makeTrack(index + 10))
    let state = playNow(EMPTY_QUEUE, context, 0)
    state = enqueue(enqueue(state, a), b)

    const shuffled = setShuffle(state, true)

    expect(shuffled.manual).toEqual([a, b])
    // The whole context is still there, only the order changed.
    expect(new Set(shuffled.order)).toEqual(new Set(context.map((_, index) => index)))
    expect(queueView(shuffled).upcoming).not.toEqual(queueView(state).upcoming)
  })

  it('does not change what is playing', () => {
    const context = Array.from({ length: 20 }, (_, index) => makeTrack(index + 10))
    const state = playNow(EMPTY_QUEUE, context, 5)
    expect(setShuffle(state, true).current).toBe(state.current)
  })

  it('turning it off restores the original order', () => {
    const context = [a, b, c, d]
    const state = setShuffle(setShuffle(playNow(EMPTY_QUEUE, context, 0), true), false)
    expect(state.order).toEqual([0, 1, 2, 3])
    expect(state.current).toBe(a)
  })
})

describe('editing the manual queue', () => {
  it('removeAt takes out the given element', () => {
    const state = enqueue(enqueue(enqueue(EMPTY_QUEUE, a), b), c)
    expect(removeAt(state, 1).manual).toEqual([a, c])
  })

  it('removeAt out of range does nothing', () => {
    const state = enqueue(EMPTY_QUEUE, a)
    expect(removeAt(state, 7).manual).toEqual([a])
  })

  it('move reorders', () => {
    const state = enqueue(enqueue(enqueue(EMPTY_QUEUE, a), b), c)
    expect(move(state, 2, 0).manual).toEqual([c, a, b])
  })

  it('move saturates at the ends instead of wrapping around', () => {
    const state = enqueue(enqueue(EMPTY_QUEUE, a), b)
    expect(move(state, 0, -5).manual).toEqual([a, b])
    expect(move(state, 0, 99).manual).toEqual([b, a])
  })
})

describe('skipToManual', () => {
  it('the chosen track starts playing and the earlier ones wait for later', () => {
    const state = enqueue(enqueue(enqueue(EMPTY_QUEUE, a), b), c)
    const next = skipToManual(state, 2)
    expect(next.current).toBe(c)
    // a and b (the ones ahead of c) stay in the manual queue, in the same
    // order: they are not lost by being skipped over.
    expect(next.manual).toEqual([a, b])
  })

  it('skipping to the first track of the manual queue leaves nothing ahead of it', () => {
    const state = enqueue(enqueue(EMPTY_QUEUE, a), b)
    const next = skipToManual(state, 0)
    expect(next.current).toBe(a)
    expect(next.manual).toEqual([b])
  })

  it('discards whatever was playing before the jump, like any advance', () => {
    let state = playNow(EMPTY_QUEUE, [d], 0)
    state = enqueue(enqueue(state, a), b)
    const next = skipToManual(state, 1)
    expect(next.current).toBe(b)
    expect(next.manual).toEqual([a])
  })

  it('an out-of-range index does nothing', () => {
    const state = enqueue(EMPTY_QUEUE, a)
    expect(skipToManual(state, 7)).toEqual(state)
    expect(skipToManual(state, -1)).toEqual(state)
  })
})

describe('queueView', () => {
  it('separates what is playing, what is queued, and what follows in the context', () => {
    let state = playNow(EMPTY_QUEUE, [a, b, c], 0)
    state = enqueue(state, d)

    expect(queueView(state)).toEqual({ now: a, manual: [d], upcoming: [b, c] })
  })
})
