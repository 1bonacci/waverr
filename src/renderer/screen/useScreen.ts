import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ScanProgress, Track } from '@shared/types'
import { audioEngine } from '../audio/AudioEngine'
import { usePlayback } from '../audio/usePlayback'
import { startIndexForEntry } from './playlistPlayback'
import {
  buildQueueRows,
  manualIndexForDrop,
  occurrenceInManual,
  resolveManualIndexById
} from './queueRows'
import {
  currentSelection,
  currentView,
  INITIAL_SCREEN_STATE,
  screenReducer,
  type ContextTarget,
  type MenuId,
  type ScreenAction,
  type View
} from './viewStack'

/** A row of the screen. The view only draws this; it does not know where it
 *  came from. */
export interface ScreenItem {
  key: string
  label: string
  /** Small text on the right: folder, duration, count. */
  meta?: string
  /** true dibuja la flechita de "entra a otro nivel". */
  drillsDown?: boolean
  /** Present only on rows that are tracks: enables marking them as favorites. */
  trackId?: number
  favorite?: boolean
  /** Draws the trash icon on the row. Only on lists where removing a track from
   *  the library is what the user means -- not in the queue or a playlist,
   *  where REMOVE already means "take it out of this list". */
  canHide?: boolean
  /** Present only on rows where the context menu makes sense. */
  contextTarget?: ContextTarget
  /** Section header (NOW/NEXT UP/LATER) to draw above this row. Not a row
   *  itself: it takes no index and cannot be selected. */
  sectionHeader?: string
  /** An action row (SAVE AS PLAYLIST, + NEW PLAYLIST) rather than a track: the
   *  move-mode arithmetic ignores it, because it is neither a valid place to
   *  drop nor something that can be reordered. */
  isAction?: boolean
  activate: () => void | Promise<void>
}

export interface ScreenController {
  view: View
  title: string
  items: ScreenItem[]
  selected: number
  loading: boolean
  scan: ScanProgress | null
  dispatch: (action: ScreenAction) => void
  /** Runs the selected row. */
  activate: () => void
  /** Drops the row held in move mode onto row `index`. This is what a mouse
   *  click uses (unlike OK, which drops wherever the drag already was). */
  dropAt: (index: number) => void
  moveBy: (delta: number) => void
  /** Toggles the selected track, or the one playing when there is no list. */
  toggleFavorite: () => void
  /** Opens the context menu on row `index`, if it has any actions defined. */
  openContextMenu: (index: number) => void
  /** Hides a track from the library. The file on disk is left alone. */
  hideTrack: (trackId: number, label: string) => void
  /** The track hidden a moment ago, while it can still be put back. */
  undo: { trackId: number; label: string } | null
  undoHide: () => void
  /** Applies the current view's `PromptIntent`. A no-op outside `prompt`. */
  confirmPrompt: () => void
  /** Error message for the current prompt (duplicate name), or null if none. */
  promptError: string | null
}

const ROOT_MENU: Array<{ id: string; label: string; view: View }> = [
  { id: 'tracks', label: 'ALL TRACKS', view: { kind: 'menu', menu: 'tracks', selected: 0 } },
  { id: 'recent', label: 'RECENT', view: { kind: 'menu', menu: 'recent', selected: 0 } },
  { id: 'favorites', label: 'FAVORITES', view: { kind: 'menu', menu: 'favorites', selected: 0 } },
  { id: 'playlists', label: 'PLAYLISTS', view: { kind: 'menu', menu: 'playlists', selected: 0 } },
  { id: 'queue', label: 'QUEUE', view: { kind: 'queue', selected: 0, moving: null } },
  { id: 'settings', label: 'SETTINGS', view: { kind: 'menu', menu: 'settings', selected: 0 } }
]

/**
 * How many rows a list view loads at once.
 *
 * ALL TRACKS is the whole library in one flat list, so a small cap here would
 * silently hide files. Every row is mounted (no virtualization), which is fine
 * for a real library of a few hundred to a few thousand files.
 */
const LIST_LIMIT = 5000

/** How long the offer to undo a hidden track stays on screen. */
const UNDO_WINDOW_MS = 5000

export function useScreen(): ScreenController {
  const [state, dispatch] = useReducer(screenReducer, INITIAL_SCREEN_STATE)
  const [items, setItems] = useState<ScreenItem[]>([])
  const [loading, setLoading] = useState(false)
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [revision, setRevision] = useState(0)
  // The track hidden a moment ago, while the offer to undo is still standing.
  const [undo, setUndo] = useState<{ trackId: number; label: string } | null>(null)
  const [promptError, setPromptError] = useState<string | null>(null)
  // The QUEUE view reads the engine directly rather than the database: without
  // this, queueing or moving to the next track would not refresh what is shown.
  const playback = usePlayback()

  const view = currentView(state)
  const selected = currentSelection(state)

  // The track being added to a playlist, if any: it comes from the nearest
  // `context` view on the stack (the picker is pushed on top of it).
  const pendingTrackId = useMemo(() => {
    for (let index = state.stack.length - 1; index >= 0; index--) {
      const entry = state.stack[index]
      if (entry?.kind === 'context') return entry.target.trackId ?? null
    }
    return null
  }, [state.stack])

  useEffect(() => {
    return window.waverr.library.onScanProgress((progress) => {
      setScan(progress.phase === 'done' ? null : progress)
      // Once the scan finishes, the visible list may have gone stale.
      if (progress.phase === 'done') setRevision((value) => value + 1)
    })
  }, [])

  // Stable key for the view: it only reloads when what is being looked at
  // changes, not when the selection moves.
  const viewKey = useMemo(() => describeView(view), [view])

  // Stops a slow load from overwriting the result of a later one.
  const loadTokenRef = useRef(0)

  // The row the current context menu was opened on, if any. "PLAY NOW" reuses
  // it as-is so it inherits the same context (the whole list that was on
  // screen) as a normal activation, instead of collapsing to a one-track list.
  const contextRowActivateRef = useRef<(() => void | Promise<void>) | null>(null)

  // Read by `undoHide`, which must not be rebuilt every time the offer changes.
  const undoRef = useRef(undo)
  undoRef.current = undo

  // The offer stands for a few seconds. Hiding another track replaces it, so
  // only the most recent one can be taken back -- past that, HIDDEN TRACKS is
  // where they are restored from.
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [undo])

  useEffect(() => {
    const token = ++loadTokenRef.current
    let cancelled = false

    async function load(): Promise<void> {
      // The previous list is dropped up front: if it stayed drawn while the new
      // one loads, a quick OK would activate the old row.
      setItems([])
      setLoading(true)
      setPromptError(null)
      const next = await buildItems(view, dispatch, pendingTrackId, contextRowActivateRef.current, () =>
        setRevision((value) => value + 1)
      )
      if (!cancelled && token === loadTokenRef.current) {
        setItems(next)
        setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // `view` is rebuilt on every selection move; `viewKey` is not.
    // `playback.track?.id` and `playback.manualCount` cover the QUEUE view: it
    // has no key of its own (`viewKey` is the constant 'queue'), so without
    // them it would never notice that NOW changed or that something was queued
    // or removed by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, revision, pendingTrackId, playback.track?.id, playback.manualCount])

  // How many rows count for the move-mode arithmetic: everything except action
  // rows (SAVE AS PLAYLIST). Without this filter the marker could come to rest
  // on that row, which is neither a track nor a valid place to drop.
  const movableRowCount = useMemo(() => items.filter((item) => !item.isAction).length, [items])

  // Drops the row held in move mode at position `toIndex`, whether it came from
  // OK (position already stored in `moving.to`) or a click (the row that was
  // touched). Shared by `activate` and `dropAt` so mouse and keyboard drop
  // exactly the same way.
  const performDrop = useCallback(
    (toIndex: number) => {
      const view_ = view
      if ((view_.kind !== 'queue' && view_.kind !== 'playlist') || !view_.moving) return

      const { from, originId, originOccurrence } = view_.moving
      // `movableRowCount` comes from `items` (React state): the load effect
      // does `setItems([])` before every reload, and a reload is triggered
      // exactly when the current track ends mid-drag. In that window
      // `movableRowCount` drops to 0 even though the real queue is not empty;
      // clamping against that would send the target back to the start instead
      // of where the user had already left the marker. That is why the
      // fallback is `toIndex` as-is: if there truly is nothing to move, the
      // identity resolution below (or `movePlaylistItem`) finds nothing valid
      // and nothing happens.
      const to = movableRowCount > 0 ? Math.max(0, Math.min(toIndex, movableRowCount - 1)) : Math.max(0, toIndex)

      if (view_.kind === 'queue') {
        // The list may have been rebuilt while dragging (a track ending
        // consumes the manual queue and shifts every row index): the origin is
        // resolved by the identity of the grabbed track (`originId` +
        // `originOccurrence`, to break the tie if it is queued more than once),
        // not by the row index that was stored when the drag started.
        const rows = buildQueueRows(audioEngine.getQueueView())
        const originIndex = resolveManualIndexById(rows, originId, originOccurrence)
        // If it is no longer there (consumed on its own during the drag) there
        // is nothing to move: dropping does nothing different from cancelling.
        if (originIndex !== null) {
          audioEngine.moveInQueue(originIndex, manualIndexForDrop(rows, to))
        }
      } else {
        void window.waverr.library.movePlaylistItem(view_.playlistId, from, to)
      }

      dispatch({ type: 'dropMove', to })
      setRevision((current) => current + 1)
    },
    [view, movableRowCount]
  )

  const activate = useCallback(() => {
    const view_ = view
    // With a row held, OK drops it where it already was instead of activating it.
    if ((view_.kind === 'queue' || view_.kind === 'playlist') && view_.moving) {
      performDrop(view_.moving.to)
      return
    }

    const item = items[selected]
    if (item) void item.activate()
  }, [items, selected, view, performDrop])

  const dropAt = useCallback((index: number) => performDrop(index), [performDrop])

  const moveBy = useCallback(
    (delta: number) => {
      const view_ = view
      // With a row held, only track rows count: the marker cannot come to rest
      // on SAVE AS PLAYLIST.
      const moving = (view_.kind === 'queue' || view_.kind === 'playlist') && view_.moving !== null
      dispatch({ type: 'move', delta, itemCount: moving ? movableRowCount : items.length })
    },
    [items.length, movableRowCount, view]
  )

  const toggleFavorite = useCallback(() => {
    // In a list the selected row wins; in the playback view, the track that is
    // playing.
    const trackId = items[selected]?.trackId ?? audioEngine.getState().track?.id
    if (trackId === undefined) return

    void window.waverr.library.toggleFavorite(trackId).then(() => {
      setRevision((value) => value + 1)
    })
  }, [items, selected])

  /**
   * Hides a track and offers to put it back.
   *
   * Pruning a folder of samples means doing this many times in a row, so it
   * takes effect immediately rather than asking first -- the undo is what makes
   * that safe. Anything hidden is still listed under SETTINGS > HIDDEN TRACKS
   * once the offer expires.
   */
  const hideTrack = useCallback((trackId: number, label: string) => {
    void window.waverr.library.setTrackHidden(trackId, true).then(() => {
      setUndo({ trackId, label })
      setRevision((value) => value + 1)
    })
  }, [])

  const undoHide = useCallback(() => {
    const pending = undoRef.current
    if (!pending) return
    setUndo(null)
    void window.waverr.library.setTrackHidden(pending.trackId, false).then(() => {
      setRevision((value) => value + 1)
    })
  }, [])

  const openContextMenu = useCallback(
    (index: number) => {
      const target = items[index]?.contextTarget
      if (!target) return
      contextRowActivateRef.current = items[index]?.activate ?? null
      dispatch({ type: 'setSelection', index })
      dispatch({ type: 'push', view: { kind: 'context', target, selected: 0 } })
    },
    [items]
  )

  const confirmPrompt = useCallback(async () => {
    if (view.kind !== 'prompt') return
    const value = view.value.trim()
    if (value.length === 0) return

    const intent = view.intent
    if (intent.kind === 'newPlaylist') {
      const playlist = await window.waverr.library.createPlaylist(value)
      if (!playlist) {
        setPromptError('ALREADY EXISTS')
        return
      }
      if (intent.trackIdToAdd !== undefined) {
        await window.waverr.library.addToPlaylist(playlist.id, intent.trackIdToAdd)
      }
    } else if (intent.kind === 'renamePlaylist') {
      if (!(await window.waverr.library.renamePlaylist(intent.playlistId, value))) {
        setPromptError('ALREADY EXISTS')
        return
      }
    } else {
      const queue = audioEngine.getQueueView()
      const trackIds = [queue.now, ...queue.manual, ...queue.upcoming]
        .filter((track): track is Track => track !== null)
        .map((track) => track.id)
      if (!(await window.waverr.library.createPlaylistFromTracks(value, trackIds))) {
        setPromptError('ALREADY EXISTS')
        return
      }
    }

    setPromptError(null)
    dispatch({ type: 'confirmPrompt' })
    // If the prompt came from the "ADD TO PLAYLIST" picker (it carries the
    // track to add), it has to land in the same place as choosing an existing
    // playlist: the list it came from. The stack in that case is
    // [..., list, context, playlistPicker, prompt]; 'confirmPrompt' already
    // popped the prompt, so two more 'back's are needed to pop the picker and
    // the context menu. The other use of newPlaylist (from the PLAYLISTS view,
    // with no trackIdToAdd) has neither that picker nor that context underneath:
    // there, the user should stay looking at the playlist list with the new one
    // in it.
    if (intent.kind === 'newPlaylist' && intent.trackIdToAdd !== undefined) {
      dispatch({ type: 'back' })
      dispatch({ type: 'back' })
    }
    setRevision((current) => current + 1)
  }, [view])

  return {
    view,
    title: titleFor(view),
    items,
    selected,
    loading,
    scan,
    dispatch,
    activate,
    dropAt,
    moveBy,
    toggleFavorite,
    openContextMenu,
    hideTrack,
    undo,
    undoHide,
    confirmPrompt: () => void confirmPrompt(),
    promptError
  }
}

function describeView(view: View): string {
  switch (view.kind) {
    case 'menu':
      return `menu:${view.menu}`
    case 'search':
      return `search:${view.query}`
    case 'queue':
      return 'queue'
    case 'playlist':
      return `playlist:${view.playlistId}`
    case 'prompt':
      return `prompt:${view.intent.kind}`
    case 'context':
      return `context:${view.target.origin}:${view.target.index}`
    case 'nowPlaying':
      return 'nowPlaying'
  }
}

function titleFor(view: View): string {
  switch (view.kind) {
    case 'menu':
      return MENU_TITLES[view.menu]
    case 'search':
      return `SEARCH: ${view.query.toUpperCase()}`
    case 'queue':
      return 'QUEUE'
    case 'playlist':
      return view.name.toUpperCase()
    case 'prompt':
      return view.label
    case 'context':
      return 'ACTIONS'
    case 'nowPlaying':
      return 'NOW PLAYING'
  }
}

const MENU_TITLES: Record<MenuId, string> = {
  root: 'WAVERR',
  tracks: 'ALL TRACKS',
  recent: 'RECENT',
  favorites: 'FAVORITES',
  playlists: 'PLAYLISTS',
  playlistPicker: 'ADD TO PLAYLIST',
  settings: 'SETTINGS',
  hiddenTracks: 'HIDDEN TRACKS'
}

async function buildItems(
  view: View,
  dispatch: (action: ScreenAction) => void,
  pendingTrackId: number | null,
  contextRowActivate: (() => void | Promise<void>) | null,
  /** Rebuilds the current list. For rows that change the data underneath them
   *  and stay where they are, which navigation alone would not pick up. */
  refresh: () => void
): Promise<ScreenItem[]> {
  switch (view.kind) {
    case 'nowPlaying':
      return []

    case 'menu':
      return buildMenuItems(view.menu, dispatch, pendingTrackId, refresh)

    case 'search': {
      const tracks = await window.waverr.library.search({
        query: view.query,
        sort: 'relevance',
        limit: LIST_LIMIT
      })
      return tracks.map(trackItem(tracks, dispatch))
    }

    case 'context':
      return buildContextItems(view.target, dispatch, contextRowActivate)

    case 'playlist': {
      const entries = await window.waverr.library.listPlaylistTracks(view.playlistId)
      if (entries.length === 0) return [emptyItem('PLAYLIST EMPTY')]

      return entries.map((entry, index) => ({
        key: `item-${entry.itemId}`,
        label: `${entry.missing ? '! ' : ''}${displayName(entry)}`,
        meta: entry.folder,
        trackId: entry.id,
        favorite: entry.favorite,
        contextTarget: {
          label: displayName(entry),
          index,
          origin: 'playlist',
          trackId: entry.id,
          playlistId: view.playlistId,
          itemId: entry.itemId
        },
        // Stays on the playlist, same as any other track row -- unless this is
        // the one already playing, which can only mean "take me to it".
        activate: () => {
          if (audioEngine.getState().track?.id === entry.id) {
            dispatch({ type: 'openNowPlaying' })
            return
          }
          // Missing files are skipped: if the chosen one cannot play, start at
          // the first playable track after it. If none is left, start nothing.
          const startIndex = startIndexForEntry(entries, entry.itemId)
          if (startIndex === null) return
          void audioEngine.playNow(
            entries.filter((candidate) => !candidate.missing),
            startIndex
          )
        }
      }))
    }

    case 'queue': {
      const rows = buildQueueRows(audioEngine.getQueueView())
      const upcomingTracks = rows
        .filter((row) => row.section === 'upcoming')
        .map((row) => row.track)
      const items: ScreenItem[] = []

      for (const row of rows) {
        if (row.section === 'now') {
          items.push({
            key: 'now',
            label: displayName(row.track),
            meta: row.track.folder,
            sectionHeader: 'NOW',
            activate: () => dispatch({ type: 'openNowPlaying' })
          })
          continue
        }

        if (row.section === 'manual') {
          const manualIndex = row.manualIndex
          items.push({
            key: `manual-${manualIndex}-${row.track.id}`,
            label: displayName(row.track),
            meta: row.track.folder,
            // Header only on the first row of the section, so it does not
            // repeat on every queued track.
            sectionHeader: manualIndex === 0 ? 'NEXT UP' : undefined,
            trackId: row.track.id,
            favorite: row.track.favorite,
            contextTarget: {
              label: displayName(row.track),
              // The index is within the manual queue: what moveInQueue and
              // removeFromQueue understand. Only an initial reference (see the
              // comment on ContextTarget): MOVE and REMOVE resolve by trackId +
              // occurrence, not by this index.
              index: manualIndex,
              origin: 'queue',
              trackId: row.track.id,
              // Queueing the same track twice is allowed on purpose: this
              // ordinal is what lets this copy be told apart from another equal
              // one if it needs to be found again later.
              occurrence: occurrenceInManual(rows, manualIndex)
            },
            // Jumping straight to a queued track: the ones ahead of it in the
            // manual queue are not lost, they stay there to play afterwards.
            // Stays on the queue, so the rest of it is still in view.
            activate: () => void audioEngine.skipToManual(manualIndex)
          })
          continue
        }

        // LATER: never carries a contextTarget, so it never offers MOVE/REMOVE.
        const upcomingIndex = row.upcomingIndex
        items.push({
          key: `upcoming-${upcomingIndex}-${row.track.id}`,
          label: displayName(row.track),
          meta: row.track.folder,
          sectionHeader: upcomingIndex === 0 ? 'LATER' : undefined,
          trackId: row.track.id,
          favorite: row.track.favorite,
          activate: () => void audioEngine.playNow(upcomingTracks, upcomingIndex)
        })
      }

      if (items.length === 0) return [emptyItem('QUEUE EMPTY')]

      items.push({
        key: 'save',
        label: 'SAVE AS PLAYLIST',
        isAction: true,
        activate: () =>
          dispatch({
            type: 'push',
            view: { kind: 'prompt', label: 'NAME', value: '', intent: { kind: 'saveQueue' } }
          })
      })

      return items
    }

    case 'prompt':
      return []
  }
}

async function buildMenuItems(
  menu: string,
  dispatch: (action: ScreenAction) => void,
  pendingTrackId: number | null,
  refresh: () => void
): Promise<ScreenItem[]> {
  switch (menu) {
    case 'root':
      return ROOT_MENU.map((entry) => ({
        key: entry.id,
        label: entry.label,
        drillsDown: true,
        activate: () => dispatch({ type: 'push', view: entry.view })
      }))

    /**
     * The whole library as one flat list. There is deliberately no folder
     * browsing: a producer's library is dozens of project folders, and having
     * to drill into each one to reach a file is backwards.
     *
     * Sorting groups tracks by folder so files from the same session stay
     * together, but it is still a single scrollable list. Because `trackItem`
     * hands this entire array to the player as the playback context, skipping
     * forward walks the whole library instead of stopping at a folder edge.
     */
    case 'tracks': {
      const tracks = await window.waverr.library.search({ sort: 'folder', limit: LIST_LIMIT })
      if (tracks.length === 0) return [emptyItem('NO TRACKS')]
      return tracks.map(trackItem(tracks, dispatch))
    }

    case 'recent': {
      const tracks = await window.waverr.library.search({ sort: 'recent', limit: LIST_LIMIT })
      if (tracks.length === 0) return [emptyItem('NOTHING YET')]
      return tracks.map(trackItem(tracks, dispatch))
    }

    case 'favorites': {
      const tracks = await window.waverr.library.search({
        onlyFavorites: true,
        sort: 'folder',
        limit: LIST_LIMIT
      })
      if (tracks.length === 0) return [emptyItem('NO FAVORITES')]
      return tracks.map(trackItem(tracks, dispatch))
    }

    /**
     * Everything hidden from the library, so a mistake is never permanent.
     * These rows restore instead of playing: there is nothing to listen to
     * here, the whole point of the screen is putting a file back.
     */
    case 'hiddenTracks': {
      const tracks = await window.waverr.library.search({
        onlyHidden: true,
        sort: 'folder',
        limit: LIST_LIMIT
      })
      if (tracks.length === 0) return [emptyItem('NOTHING HIDDEN')]

      return tracks.map((track) => ({
        key: String(track.id),
        label: displayName(track),
        meta: track.folder,
        trackId: track.id,
        activate: async () => {
          await window.waverr.library.setTrackHidden(track.id, false)
          // The row has to leave a list the user is still looking at, and
          // nothing about the view itself changed, so ask for a rebuild.
          refresh()
        }
      }))
    }

    case 'playlists': {
      const playlists = await window.waverr.library.listPlaylists()
      const items: ScreenItem[] = [
        {
          key: 'new',
          label: '+ NEW PLAYLIST',
          activate: () =>
            dispatch({
              type: 'push',
              view: { kind: 'prompt', label: 'NAME', value: '', intent: { kind: 'newPlaylist' } }
            })
        }
      ]

      for (const playlist of playlists) {
        items.push({
          key: `playlist-${playlist.id}`,
          label: playlist.name.toUpperCase(),
          meta: String(playlist.trackCount),
          drillsDown: true,
          contextTarget: {
            label: playlist.name,
            index: 0,
            origin: 'library',
            playlistId: playlist.id
          },
          activate: () =>
            dispatch({
              type: 'push',
              view: {
                kind: 'playlist',
                playlistId: playlist.id,
                name: playlist.name,
                selected: 0,
                moving: null
              }
            })
        })
      }

      return items
    }

    case 'playlistPicker': {
      // Submenu of ADD TO PLAYLIST. The target track comes from the `context`
      // view left underneath it on the stack.
      const playlists = await window.waverr.library.listPlaylists()
      const items: ScreenItem[] = [
        {
          key: 'new',
          label: '+ NEW PLAYLIST',
          activate: () =>
            dispatch({
              type: 'push',
              view: {
                kind: 'prompt',
                label: 'NAME',
                value: '',
                intent: { kind: 'newPlaylist', trackIdToAdd: pendingTrackId ?? undefined }
              }
            })
        }
      ]

      for (const playlist of playlists) {
        items.push({
          key: `pick-${playlist.id}`,
          label: playlist.name.toUpperCase(),
          meta: String(playlist.trackCount),
          activate: async () => {
            if (pendingTrackId !== null) {
              await window.waverr.library.addToPlaylist(playlist.id, pendingTrackId)
            }
            // Back to the list the user came from, rather than leaving them
            // navigating inside the playlist.
            dispatch({ type: 'back' })
            dispatch({ type: 'back' })
          }
        })
      }

      return items
    }

    case 'settings': {
      const [roots, stats] = await Promise.all([
        window.waverr.library.listRoots(),
        window.waverr.library.stats()
      ])

      const actions: ScreenItem[] = [
        {
          key: 'add',
          label: '+ ADD FOLDER',
          activate: async () => {
            await window.waverr.library.pickRoot()
          }
        },
        {
          key: 'rescan',
          label: 'RESCAN ALL',
          activate: async () => {
            await window.waverr.library.rescan()
          }
        },
        {
          key: 'stats',
          label: `${stats.trackCount} TRACKS`,
          meta: stats.missingCount > 0 ? `${stats.missingCount} MISSING` : undefined,
          activate: () => {}
        }
      ]

      // Only worth a row once something is actually hidden.
      if (stats.hiddenCount > 0) {
        actions.push({
          key: 'hidden',
          label: 'HIDDEN TRACKS',
          meta: String(stats.hiddenCount),
          drillsDown: true,
          activate: () =>
            dispatch({
              type: 'push',
              view: { kind: 'menu', menu: 'hiddenTracks', selected: 0 }
            })
        })
      }

      const rootItems: ScreenItem[] = roots.map((root) => ({
        key: `root-${root.id}`,
        label: shortenPath(root.path),
        meta: String(root.trackCount),
        activate: async () => {
          await window.waverr.library.removeRoot(root.id)
          await window.waverr.library.rescan()
        }
      }))

      return [...actions, ...rootItems]
    }

    default:
      return []
  }
}

/**
 * Actions on a row. MOVE and REMOVE only appear where they make sense: in the
 * queue and inside a playlist.
 */
async function buildContextItems(
  target: ContextTarget,
  dispatch: (action: ScreenAction) => void,
  contextRowActivate: (() => void | Promise<void>) | null
): Promise<ScreenItem[]> {
  const items: ScreenItem[] = []

  if (target.trackId !== undefined) {
    const trackId = target.trackId

    items.push({
      key: 'play',
      label: 'PLAY NOW',
      activate: async () => {
        dispatch({ type: 'back' })
        // Reuses the row's normal activation (the same one a click or a direct
        // OK runs): that way it inherits the whole originating list as the
        // context, instead of collapsing it to a single track.
        if (contextRowActivate) await contextRowActivate()
      }
    })

    items.push({
      key: 'next',
      label: 'PLAY NEXT',
      activate: async () => {
        const track = await window.waverr.library.getTrack(trackId)
        if (track) audioEngine.enqueueNext(track)
        dispatch({ type: 'back' })
      }
    })

    items.push({
      key: 'last',
      label: 'ADD TO QUEUE',
      activate: async () => {
        const track = await window.waverr.library.getTrack(trackId)
        if (track) audioEngine.enqueue(track)
        dispatch({ type: 'back' })
      }
    })

    items.push({
      key: 'playlist',
      label: 'ADD TO PLAYLIST',
      drillsDown: true,
      activate: () =>
        dispatch({
          type: 'push',
          view: { kind: 'menu', menu: 'playlistPicker', selected: 0 }
        })
    })

    items.push({
      key: 'favorite',
      label: 'FAVORITE',
      activate: async () => {
        await window.waverr.library.toggleFavorite(trackId)
        dispatch({ type: 'back' })
      }
    })
  }

  // A row that is a playlist itself (not a track inside one): play, rename and
  // delete.
  if (target.playlistId !== undefined && target.trackId === undefined) {
    const playlistId = target.playlistId

    items.push({
      key: 'play',
      label: 'PLAY',
      activate: async () => {
        const entries = await window.waverr.library.listPlaylistTracks(playlistId)
        const playable = entries.filter((entry) => !entry.missing)
        dispatch({ type: 'back' })
        // Empty playlist, or every track missing: nowhere to start.
        if (playable.length === 0) return
        dispatch({ type: 'openNowPlaying' })
        void audioEngine.playNow(playable, 0)
      }
    })

    items.push({
      key: 'rename',
      label: 'RENAME',
      activate: () => {
        dispatch({ type: 'back' })
        dispatch({
          type: 'push',
          view: {
            kind: 'prompt',
            label: 'NEW NAME',
            value: '',
            intent: { kind: 'renamePlaylist', playlistId }
          }
        })
      }
    })
    items.push({
      key: 'delete',
      label: 'DELETE PLAYLIST',
      activate: async () => {
        await window.waverr.library.deletePlaylist(playlistId)
        dispatch({ type: 'back' })
      }
    })
  }

  if (target.origin === 'queue' || target.origin === 'playlist') {
    items.push({
      key: 'move',
      label: 'MOVE',
      activate: () => {
        // No `setSelection` is needed here: `openContextMenu` already left the
        // selection of the view underneath on the row that was touched
        // (long-press or right click), and `back` does not touch it. Restoring
        // it with `target.index` would also be wrong for the queue when a NOW
        // row is present: that index is a domain index (position in the manual
        // queue), not a row index, and the two differ by one in exactly that
        // case.
        //
        // The identity stored for dropping later (`originId`) is the itemId
        // inside a playlist or the trackId inside the queue: whatever keeps
        // identifying this row if the list is rebuilt mid-drag (for example, a
        // track ending and shifting the manual queue's row indices).
        // `originOccurrence` (0 in a playlist, where itemId is already unique)
        // breaks the tie when that track is queued more than once.
        const originId = target.origin === 'playlist' ? target.itemId : target.trackId
        if (originId === undefined) return
        dispatch({ type: 'back' })
        dispatch({ type: 'startMove', originId, originOccurrence: target.occurrence ?? 0 })
      }
    })

    items.push({
      key: 'remove',
      label: 'REMOVE',
      activate: async () => {
        if (target.origin === 'queue') {
          // `target.index` is not used: if the current track ended while the
          // ACTIONS menu was open, that index went stale and would remove the
          // wrong row (exactly what the queue's invariant forbids: nothing the
          // user queued disappears unless they remove it). It is resolved by
          // identity again, same as MOVE.
          if (target.trackId !== undefined) {
            const rows = buildQueueRows(audioEngine.getQueueView())
            const manualIndex = resolveManualIndexById(rows, target.trackId, target.occurrence ?? 0)
            if (manualIndex !== null) audioEngine.removeFromQueue(manualIndex)
          }
        } else if (target.itemId !== undefined) {
          await window.waverr.library.removeFromPlaylist(target.itemId)
        }
        dispatch({ type: 'back' })
      }
    })
  }

  return items
}

function trackItem(
  tracks: Track[],
  dispatch: (action: ScreenAction) => void
): (track: Track, index: number) => ScreenItem {
  return (track, index) => ({
    key: String(track.id),
    label: displayName(track),
    // The containing folder, not the duration: with one flat list covering the
    // whole library, where a file came from is the thing you cannot infer.
    // Duration still shows in the NOW PLAYING view.
    meta: track.folder,
    trackId: track.id,
    favorite: track.favorite,
    canHide: true,
    contextTarget: {
      label: displayName(track),
      index,
      origin: 'library',
      trackId: track.id
    },
    // Starting a track leaves the list alone: picking one is not a reason to
    // stop browsing, and jumping away meant going back every time to hear the
    // next one. Picking the one already playing is the exception -- there is
    // nothing to start, so it can only mean "take me to it".
    //
    // The visible list becomes the queue: that is how NEXT follows what is on
    // screen.
    activate: () => {
      if (audioEngine.getState().track?.id === track.id) {
        dispatch({ type: 'openNowPlaying' })
        return
      }
      void audioEngine.playNow(tracks, index)
    }
  })
}

function emptyItem(label: string): ScreenItem {
  return { key: 'empty', label, activate: () => {} }
}

/** An export with no tags is shown by its filename, which is what its author
 *  recognizes. */
export function displayName(track: Track): string {
  return track.hasTags && track.title ? track.title : track.filename
}

function shortenPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  return `...${parts.slice(-2).join('/')}`
}
