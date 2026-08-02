/**
 * Screen navigation, modelled as a stack of views the way an iPod does it.
 *
 * A pure state machine: it knows nothing about React, Electron or the database.
 * Each view describes WHAT to show; the component fetches the data. That keeps
 * it fully testable and stops navigation getting tangled up with data loading.
 */

export type MenuId =
  | 'root'
  /** The whole library as one flat list. There is no folder browsing. */
  | 'tracks'
  | 'recent'
  | 'favorites'
  | 'playlists'
  /** Submenu of "ADD TO PLAYLIST". */
  | 'playlistPicker'
  | 'settings'
  /** Submenu of SETTINGS: the tracks hidden from the library, so hiding one by
   *  mistake is not permanent. */
  | 'hiddenTracks'

/** Where the row the context menu was opened on came from. Determines which
 *  actions make sense: only inside the queue or a playlist can something be
 *  moved or removed. */
export type ContextOrigin = 'library' | 'queue' | 'playlist'

export interface ContextTarget {
  label: string
  /** Position within the originating list. Only an initial reference: if the
   *  current track changes while the ACTIONS menu is open, this position goes
   *  stale. MOVE and REMOVE do not trust it to resolve the row; they use
   *  `trackId`/`occurrence` (queue) or `itemId` (playlist), which identify the
   *  row rather than its position. */
  index: number
  origin: ContextOrigin
  trackId?: number
  playlistId?: number
  /** The playlist_items row, when the origin is a playlist. */
  itemId?: number
  /** Only when `origin` is 'queue': the ordinal among the copies of `trackId`
   *  in the manual queue (0 = first), computed when this row was built.
   *  Queueing the same track twice is allowed on purpose, so `trackId` alone
   *  is not enough to find this row again later. */
  occurrence?: number
}

export type PromptIntent =
  | { kind: 'newPlaylist'; trackIdToAdd?: number }
  | { kind: 'renamePlaylist'; playlistId: number }
  | { kind: 'saveQueue' }

/** The row held in move mode: where it came from and where it is now.
 *  `originId` is the identity of the grabbed track (its trackId in the queue,
 *  its itemId in a playlist), not its position: if the list is rebuilt mid-drag
 *  (a track ending consumes the manual queue and shifts every row index),
 *  `from`/`to` go stale but `originId` still points at the right row. */
export interface MovingState {
  from: number
  to: number
  originId: number
  /** Ordinal among the copies sharing `originId` (0 = first), computed when the
   *  row was grabbed. Queueing the same track twice is allowed on purpose:
   *  without this, resolving by identity would always land on the first copy by
   *  trackId, no matter which one was actually grabbed. */
  originOccurrence: number
}

export type View =
  | { kind: 'menu'; menu: MenuId; selected: number }
  | { kind: 'search'; query: string; selected: number }
  | { kind: 'queue'; selected: number; moving: MovingState | null }
  | { kind: 'playlist'; playlistId: number; name: string; selected: number; moving: MovingState | null }
  | { kind: 'prompt'; label: string; value: string; intent: PromptIntent }
  | { kind: 'context'; target: ContextTarget; selected: number }
  | { kind: 'nowPlaying' }

export interface ScreenState {
  stack: View[]
}

export type ScreenAction =
  /** Move the selection. `itemCount` comes from the component, which is what
   *  knows how many rows there are. */
  | { type: 'move'; delta: number; itemCount: number }
  | { type: 'setSelection'; index: number }
  | { type: 'push'; view: View }
  | { type: 'back' }
  | { type: 'home' }
  | { type: 'openNowPlaying' }
  | { type: 'typeChar'; char: string }
  /** `fromRepeat` marks a keyboard autorepeat tick. Deleting past the last
   *  letter leaves the view, but only on a deliberate fresh press: holding
   *  Backspace to clear a query would otherwise run straight through the empty
   *  string and drop the user back in the menu. */
  | { type: 'backspace'; fromRepeat?: boolean }
  | { type: 'startMove'; originId: number; originOccurrence: number }
  | { type: 'moveHeld'; delta: number; itemCount: number }
  /** `to`, when present, fixes where the drag ended (clicking a row with the
   *  mouse drops straight there, without going through `moveHeld`). Without
   *  `to` it uses the position already stored in `moving` (dropping with the
   *  keyboard or the wheel). */
  | { type: 'dropMove'; to?: number }
  | { type: 'cancelMove' }
  | { type: 'confirmPrompt' }

export const INITIAL_SCREEN_STATE: ScreenState = {
  stack: [{ kind: 'menu', menu: 'root', selected: 0 }]
}

export function currentView(state: ScreenState): View {
  return state.stack[state.stack.length - 1] ?? INITIAL_SCREEN_STATE.stack[0]!
}

/** Selected index of the current view, or -1 when the view is not a list. */
export function currentSelection(state: ScreenState): number {
  const view = currentView(state)
  return view.kind === 'nowPlaying' || view.kind === 'prompt' ? -1 : view.selected
}

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  const view = currentView(state)

  switch (action.type) {
    case 'move': {
      if (view.kind === 'nowPlaying' || view.kind === 'prompt') return state
      if (action.itemCount <= 0) return state
      // With a row held, moving the selection means dragging it.
      if ((view.kind === 'queue' || view.kind === 'playlist') && view.moving) {
        return screenReducer(state, {
          type: 'moveHeld',
          delta: action.delta,
          itemCount: action.itemCount
        })
      }
      // Wraps around at the ends, like an iPod's wheel.
      const next = (view.selected + action.delta + action.itemCount) % action.itemCount
      return replaceTop(state, { ...view, selected: next })
    }

    case 'setSelection': {
      if (view.kind === 'nowPlaying' || view.kind === 'prompt') return state
      if (action.index < 0) return state
      return replaceTop(state, { ...view, selected: action.index })
    }

    case 'push':
      return { stack: [...state.stack, action.view] }

    case 'back': {
      // While a row is being moved, MENU cancels the move rather than leaving
      // the view: leaving halfway through a reorder is surprising.
      if ((view.kind === 'queue' || view.kind === 'playlist') && view.moving) {
        return screenReducer(state, { type: 'cancelMove' })
      }
      // The stack is never emptied: the root menu is the floor.
      if (state.stack.length <= 1) return state
      return { stack: state.stack.slice(0, -1) }
    }

    case 'home':
      return INITIAL_SCREEN_STATE

    case 'openNowPlaying': {
      if (view.kind === 'nowPlaying') return state
      return { stack: [...state.stack, { kind: 'nowPlaying' }] }
    }

    case 'typeChar': {
      if (view.kind === 'prompt') {
        return replaceTop(state, { ...view, value: view.value + action.char })
      }
      // Letters do nothing in the context menu: it is a short list of actions,
      // not somewhere to search.
      if (view.kind === 'context') return state
      // Typing anywhere opens search: it is the fastest way to reach a file
      // without walking through menus.
      if (view.kind === 'search') {
        return replaceTop(state, { ...view, query: view.query + action.char, selected: 0 })
      }
      return {
        stack: [...state.stack, { kind: 'search', query: action.char, selected: 0 }]
      }
    }

    case 'backspace': {
      if (view.kind === 'prompt') {
        if (view.value.length === 0) {
          return action.fromRepeat ? state : screenReducer(state, { type: 'back' })
        }
        return replaceTop(state, { ...view, value: view.value.slice(0, -1) })
      }
      if (view.kind !== 'search') return state
      // Deleting past the last letter of a search leaves the search -- but a
      // held key only ever empties it, never exits.
      if (view.query.length === 0) {
        return action.fromRepeat ? state : screenReducer(state, { type: 'back' })
      }
      return replaceTop(state, { ...view, query: view.query.slice(0, -1), selected: 0 })
    }

    case 'confirmPrompt': {
      if (view.kind !== 'prompt') return state
      return { stack: state.stack.slice(0, -1) }
    }

    case 'startMove': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (view.moving) return state
      return replaceTop(state, {
        ...view,
        moving: {
          from: view.selected,
          to: view.selected,
          originId: action.originId,
          originOccurrence: action.originOccurrence
        }
      })
    }

    case 'moveHeld': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (!view.moving || action.itemCount <= 0) return state
      const to = Math.max(0, Math.min(view.moving.to + action.delta, action.itemCount - 1))
      return replaceTop(state, { ...view, moving: { ...view.moving, to }, selected: to })
    }

    case 'dropMove': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (!view.moving) return state
      const to = action.to ?? view.moving.to
      return replaceTop(state, { ...view, moving: null, selected: to })
    }

    case 'cancelMove': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (!view.moving) return state
      return replaceTop(state, { ...view, moving: null, selected: view.moving.from })
    }

    default:
      return state
  }
}

function replaceTop(state: ScreenState, view: View): ScreenState {
  return { stack: [...state.stack.slice(0, -1), view] }
}
