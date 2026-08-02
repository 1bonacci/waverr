import { describe, expect, it } from 'vitest'
import {
  startIndexForEntry,
  type PlaylistPlaybackEntry
} from '../../src/renderer/screen/playlistPlayback'

function entries(...missing: boolean[]): PlaylistPlaybackEntry[] {
  return missing.map((isMissing, index) => ({ itemId: index + 1, missing: isMissing }))
}

describe('startIndexForEntry', () => {
  it('healthy track: starts at its own spot among the playable ones', () => {
    const list = entries(false, false, false)
    expect(startIndexForEntry(list, 2)).toBe(1)
  })

  it('missing track with playable ones after it: starts at the next one that plays', () => {
    // 1 healthy, 2 missing (chosen), 3 missing, 4 healthy
    const list = entries(false, true, true, false)
    // Playable: [1, 4]. 4 is the next one that plays after 2.
    expect(startIndexForEntry(list, 2)).toBe(1)
  })

  it('missing track with nothing playable after it: starts nothing', () => {
    const list = entries(false, false, true)
    expect(startIndexForEntry(list, 3)).toBeNull()
  })

  it('the whole playlist is missing: starts nothing no matter which one is chosen', () => {
    const list = entries(true, true, true)
    expect(startIndexForEntry(list, 1)).toBeNull()
    expect(startIndexForEntry(list, 2)).toBeNull()
    expect(startIndexForEntry(list, 3)).toBeNull()
  })

  it('missing entries interleaved: each one jumps to the nearest healthy one after it', () => {
    // 1 healthy, 2 missing, 3 healthy, 4 missing, 5 healthy
    const list = entries(false, true, false, true, false)
    // Playable: [1, 3, 5] -> indices 0, 1, 2
    expect(startIndexForEntry(list, 1)).toBe(0)
    expect(startIndexForEntry(list, 2)).toBe(1) // jumps to 3
    expect(startIndexForEntry(list, 3)).toBe(1)
    expect(startIndexForEntry(list, 4)).toBe(2) // jumps to 5
    expect(startIndexForEntry(list, 5)).toBe(2)
  })

  it('an itemId that does not exist in the list: starts nothing', () => {
    const list = entries(false, false)
    expect(startIndexForEntry(list, 999)).toBeNull()
  })
})
