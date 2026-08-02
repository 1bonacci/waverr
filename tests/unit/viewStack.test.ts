import { describe, expect, it } from 'vitest'
import {
  currentView,
  INITIAL_SCREEN_STATE,
  screenReducer,
  type ScreenAction,
  type ScreenState
} from '../../src/renderer/screen/viewStack'

function run(actions: ScreenAction[], from: ScreenState = INITIAL_SCREEN_STATE): ScreenState {
  return actions.reduce(screenReducer, from)
}

describe('initial state', () => {
  it('starts on the root menu', () => {
    expect(currentView(INITIAL_SCREEN_STATE)).toEqual({ kind: 'menu', menu: 'root', selected: 0 })
  })
})

describe('moving the selection', () => {
  it('goes down and up', () => {
    const state = run([{ type: 'move', delta: 1, itemCount: 5 }])
    expect(currentView(state)).toMatchObject({ selected: 1 })

    const back = screenReducer(state, { type: 'move', delta: -1, itemCount: 5 })
    expect(currentView(back)).toMatchObject({ selected: 0 })
  })

  it('wraps around at the ends', () => {
    const up = run([{ type: 'move', delta: -1, itemCount: 4 }])
    expect(currentView(up)).toMatchObject({ selected: 3 })

    const down = run([
      { type: 'setSelection', index: 3 },
      { type: 'move', delta: 1, itemCount: 4 }
    ])
    expect(currentView(down)).toMatchObject({ selected: 0 })
  })

  it('does not move with an empty list', () => {
    const state = run([{ type: 'move', delta: 1, itemCount: 0 }])
    expect(currentView(state)).toMatchObject({ selected: 0 })
  })

  it('does not apply to the playback view', () => {
    const state = run([{ type: 'openNowPlaying' }, { type: 'move', delta: 1, itemCount: 5 }])
    expect(currentView(state)).toEqual({ kind: 'nowPlaying' })
  })
})

describe('navigation', () => {
  it('pushes and pops views', () => {
    const state = run([
      { type: 'push', view: { kind: 'menu', menu: 'tracks', selected: 0 } }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'tracks' })

    const back = screenReducer(state, { type: 'back' })
    expect(currentView(back)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('keeps the previous level\'s selection when going back', () => {
    const state = run([
      { type: 'move', delta: 2, itemCount: 6 },
      { type: 'push', view: { kind: 'menu', menu: 'tracks', selected: 0 } },
      { type: 'move', delta: 3, itemCount: 10 },
      { type: 'back' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'menu', selected: 2 })
  })

  it('going back from the floor does not empty the stack', () => {
    const state = run([{ type: 'back' }, { type: 'back' }])
    expect(state.stack).toHaveLength(1)
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('home returns to the root from any depth', () => {
    const state = run([
      { type: 'push', view: { kind: 'menu', menu: 'tracks', selected: 0 } },
      { type: 'push', view: { kind: 'menu', menu: 'favorites', selected: 0 } },
      { type: 'home' }
    ])
    expect(state).toEqual(INITIAL_SCREEN_STATE)
  })

  it('does not push the playback view twice', () => {
    const state = run([{ type: 'openNowPlaying' }, { type: 'openNowPlaying' }])
    expect(state.stack.filter((view) => view.kind === 'nowPlaying')).toHaveLength(1)
  })
})

describe('search while typing', () => {
  it('typing in a menu opens search with that letter', () => {
    const state = run([{ type: 'typeChar', char: 'b' }])
    expect(currentView(state)).toEqual({ kind: 'search', query: 'b', selected: 0 })
  })

  it('keeps accumulating letters without pushing new views', () => {
    const state = run([
      { type: 'typeChar', char: 'b' },
      { type: 'typeChar', char: 'e' },
      { type: 'typeChar', char: 'a' }
    ])
    expect(currentView(state)).toMatchObject({ query: 'bea' })
    expect(state.stack).toHaveLength(2)
  })

  it('typing resets the selection (the results changed)', () => {
    const state = run([
      { type: 'typeChar', char: 'b' },
      { type: 'move', delta: 4, itemCount: 10 },
      { type: 'typeChar', char: 'e' }
    ])
    expect(currentView(state)).toMatchObject({ query: 'be', selected: 0 })
  })

  it('backspace deletes a letter', () => {
    const state = run([
      { type: 'typeChar', char: 'b' },
      { type: 'typeChar', char: 'e' },
      { type: 'backspace' }
    ])
    expect(currentView(state)).toMatchObject({ query: 'b' })
  })

  it('backspace on an empty search leaves the search', () => {
    const state = run([{ type: 'typeChar', char: 'b' }, { type: 'backspace' }, { type: 'backspace' }])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('backspace outside search does nothing', () => {
    const state = run([{ type: 'backspace' }])
    expect(state).toEqual(INITIAL_SCREEN_STATE)
  })

  it('a held backspace empties the query but stays in the search', () => {
    const state = run([
      { type: 'typeChar', char: 'b' },
      { type: 'backspace', fromRepeat: true },
      { type: 'backspace', fromRepeat: true }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'search', query: '' })
  })

  it('a held backspace still deletes letters', () => {
    const state = run([
      { type: 'typeChar', char: 'b' },
      { type: 'typeChar', char: 'e' },
      { type: 'backspace', fromRepeat: true }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'search', query: 'b' })
  })
})

describe('text prompt view', () => {
  const promptView = {
    kind: 'prompt' as const,
    label: 'NAME',
    value: '',
    intent: { kind: 'newPlaylist' as const }
  }

  it('typing writes into the prompt instead of opening search', () => {
    const state = run([
      { type: 'push', view: promptView },
      { type: 'typeChar', char: 'E' },
      { type: 'typeChar', char: 'P' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'prompt', value: 'EP' })
    expect(state.stack).toHaveLength(2)
  })

  it('backspace deletes a letter from the prompt', () => {
    const state = run([
      { type: 'push', view: promptView },
      { type: 'typeChar', char: 'E' },
      { type: 'typeChar', char: 'P' },
      { type: 'backspace' }
    ])
    expect(currentView(state)).toMatchObject({ value: 'E' })
  })

  it('backspace on an empty prompt closes it', () => {
    const state = run([{ type: 'push', view: promptView }, { type: 'backspace' }])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('a held backspace does not close an empty prompt', () => {
    const state = run([
      { type: 'push', view: promptView },
      { type: 'typeChar', char: 'X' },
      { type: 'backspace', fromRepeat: true },
      { type: 'backspace', fromRepeat: true }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'prompt', value: '' })
  })

  it('confirming closes the prompt', () => {
    const state = run([
      { type: 'push', view: promptView },
      { type: 'typeChar', char: 'X' },
      { type: 'confirmPrompt' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })
})

describe('move mode', () => {
  const queueView = { kind: 'queue' as const, selected: 1, moving: null }

  it('starting a move grabs the selected row', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 1 } })
  })

  it('moving drags the row and the selection together', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 1, itemCount: 4 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 2 }, selected: 2 })
  })

  it('moving saturates at the ends instead of wrapping around', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: -5, itemCount: 4 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 0 }, selected: 0 })
  })

  it('dropping ends move mode', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 1, itemCount: 4 },
      { type: 'dropMove' }
    ])
    expect(currentView(state)).toMatchObject({ moving: null, selected: 2 })
  })

  it('cancelling restores the selection to where it was', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 2, itemCount: 4 },
      { type: 'cancelMove' }
    ])
    expect(currentView(state)).toMatchObject({ moving: null, selected: 1 })
  })

  it('MENU does not leave the view while moving', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 2, itemCount: 4 },
      { type: 'back' }
    ])
    // If `back` confirmed the position (delegated to dropMove) instead of
    // cancelling it, `selected` would stay at 3 instead of returning to 1.
    expect(currentView(state)).toMatchObject({ kind: 'queue', moving: null, selected: 1 })
    expect(state.stack).toHaveLength(2)
  })

  it('startMove does nothing on a view that cannot be reordered', () => {
    const state = run([{ type: 'startMove', originId: 99, originOccurrence: 0 }])
    expect(state).toEqual(INITIAL_SCREEN_STATE)
  })

  it('startMove stores the identity of the grabbed row, not just its position', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 42, originOccurrence: 0 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { originId: 42 } })
  })

  it('startMove also stores the occurrence, to break ties on repeated tracks', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 42, originOccurrence: 1 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { originId: 42, originOccurrence: 1 } })
  })

  it('dropMove with an explicit `to` drops there, like a click does', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 1, itemCount: 4 },
      { type: 'dropMove', to: 3 }
    ])
    expect(currentView(state)).toMatchObject({ moving: null, selected: 3 })
  })
})

describe('context menu', () => {
  const target = {
    label: 'beat_v3.wav',
    index: 0,
    origin: 'library' as const,
    trackId: 7
  }

  it('is pushed on top of the current view', () => {
    const state = run([{ type: 'push', view: { kind: 'context', target, selected: 0 } }])
    expect(currentView(state)).toMatchObject({ kind: 'context' })
    expect(state.stack).toHaveLength(2)
  })

  it('MENU closes it and returns to the list', () => {
    const state = run([
      { type: 'push', view: { kind: 'context', target, selected: 0 } },
      { type: 'back' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('typing inside the context menu does not open search', () => {
    const state = run([
      { type: 'push', view: { kind: 'context', target, selected: 0 } },
      { type: 'typeChar', char: 'b' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'context' })
  })
})
