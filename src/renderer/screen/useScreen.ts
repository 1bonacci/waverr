import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ScanProgress, Track } from '@shared/types'
import { audioEngine } from '../audio/AudioEngine'
import { formatTime } from '../audio/usePlayback'
import { startIndexForEntry } from './playlistPlayback'
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

/** Una fila de la pantalla. La vista solo dibuja esto; no sabe de donde salio. */
export interface ScreenItem {
  key: string
  label: string
  /** Texto chico a la derecha: carpeta, duracion, cantidad. */
  meta?: string
  /** true dibuja la flechita de "entra a otro nivel". */
  drillsDown?: boolean
  /** Presente solo en filas que son pistas: habilita marcarlas como favoritas. */
  trackId?: number
  favorite?: boolean
  /** Presente solo en filas donde tiene sentido el menu contextual. */
  contextTarget?: ContextTarget
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
  /** Ejecuta la fila seleccionada. */
  activate: () => void
  moveBy: (delta: number) => void
  /** Marca/desmarca la pista seleccionada, o la que suena si no hay lista. */
  toggleFavorite: () => void
  /** Abre el menu contextual sobre la fila `index`, si tiene acciones definidas. */
  openContextMenu: (index: number) => void
  /** Aplica el `PromptIntent` de la vista actual. No hace nada fuera de `prompt`. */
  confirmPrompt: () => void
  /** Mensaje de error del prompt actual (nombre repetido), o null si no hay. */
  promptError: string | null
}

const ROOT_MENU: Array<{ id: string; label: string; view: View }> = [
  { id: 'folders', label: 'CARPETAS', view: { kind: 'menu', menu: 'folders', selected: 0 } },
  { id: 'recent', label: 'RECIENTES', view: { kind: 'menu', menu: 'recent', selected: 0 } },
  { id: 'favorites', label: 'FAVORITOS', view: { kind: 'menu', menu: 'favorites', selected: 0 } },
  { id: 'playlists', label: 'PLAYLISTS', view: { kind: 'menu', menu: 'playlists', selected: 0 } },
  { id: 'queue', label: 'COLA', view: { kind: 'queue', selected: 0, moving: null } },
  { id: 'settings', label: 'AJUSTES', view: { kind: 'menu', menu: 'settings', selected: 0 } }
]

const LIST_LIMIT = 300

export function useScreen(): ScreenController {
  const [state, dispatch] = useReducer(screenReducer, INITIAL_SCREEN_STATE)
  const [items, setItems] = useState<ScreenItem[]>([])
  const [loading, setLoading] = useState(false)
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [revision, setRevision] = useState(0)
  const [promptError, setPromptError] = useState<string | null>(null)

  const view = currentView(state)
  const selected = currentSelection(state)

  // La pista que se esta agregando a una playlist, si la hay: viene de la
  // vista `context` mas cercana en la pila (el picker se apila arriba de ella).
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
      // Al terminar el escaneo la lista visible puede haber quedado vieja.
      if (progress.phase === 'done') setRevision((value) => value + 1)
    })
  }, [])

  // Clave estable de la vista: solo se recarga cuando cambia lo que se mira,
  // no cuando se mueve la seleccion.
  const viewKey = useMemo(() => describeView(view), [view])

  // Evita que una carga lenta pise el resultado de una carga posterior.
  const loadTokenRef = useRef(0)

  useEffect(() => {
    const token = ++loadTokenRef.current
    let cancelled = false

    async function load(): Promise<void> {
      // La lista anterior se descarta de entrada: si se dejara dibujada
      // mientras carga la nueva, apretar OK rapido activaria la fila vieja.
      setItems([])
      setLoading(true)
      setPromptError(null)
      const next = await buildItems(view, dispatch, pendingTrackId)
      if (!cancelled && token === loadTokenRef.current) {
        setItems(next)
        setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // `view` se reconstruye en cada movimiento de seleccion; `viewKey` no.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, revision, pendingTrackId])

  const activate = useCallback(() => {
    const item = items[selected]
    if (item) void item.activate()
  }, [items, selected])

  const moveBy = useCallback(
    (delta: number) => dispatch({ type: 'move', delta, itemCount: items.length }),
    [items.length]
  )

  const toggleFavorite = useCallback(() => {
    // En una lista manda la fila seleccionada; en la vista de reproduccion,
    // la pista que esta sonando.
    const trackId = items[selected]?.trackId ?? audioEngine.getState().track?.id
    if (trackId === undefined) return

    void window.waverr.library.toggleFavorite(trackId).then(() => {
      setRevision((value) => value + 1)
    })
  }, [items, selected])

  const openContextMenu = useCallback(
    (index: number) => {
      const target = items[index]?.contextTarget
      if (!target) return
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
        setPromptError('YA EXISTE')
        return
      }
      if (intent.trackIdToAdd !== undefined) {
        await window.waverr.library.addToPlaylist(playlist.id, intent.trackIdToAdd)
      }
    } else if (intent.kind === 'renamePlaylist') {
      if (!(await window.waverr.library.renamePlaylist(intent.playlistId, value))) {
        setPromptError('YA EXISTE')
        return
      }
    } else {
      const queue = audioEngine.getQueueView()
      const trackIds = [queue.now, ...queue.manual, ...queue.upcoming]
        .filter((track): track is Track => track !== null)
        .map((track) => track.id)
      if (!(await window.waverr.library.createPlaylistFromTracks(value, trackIds))) {
        setPromptError('YA EXISTE')
        return
      }
    }

    setPromptError(null)
    dispatch({ type: 'confirmPrompt' })
    // Si el prompt vino del picker de "AGREGAR A PLAYLIST" (trae la pista a
    // agregar), tiene que terminar en el mismo lugar que elegir una playlist
    // ya existente: la lista de origen. La pila en ese caso es
    // [..., lista, context, playlistPicker, prompt]; 'confirmPrompt' ya saco
    // el prompt, faltan otros dos 'back' para sacar el picker y el menu
    // contextual. El otro uso de newPlaylist (desde la vista PLAYLISTS, sin
    // trackIdToAdd) no tiene ese picker ni ese context debajo: ahi hay que
    // quedarse viendo la lista de playlists con la recien creada.
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
    moveBy,
    toggleFavorite,
    openContextMenu,
    confirmPrompt: () => void confirmPrompt(),
    promptError
  }
}

function describeView(view: View): string {
  switch (view.kind) {
    case 'menu':
      return `menu:${view.menu}`
    case 'folder':
      return `folder:${view.path}`
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
    case 'folder':
      return view.name.toUpperCase()
    case 'search':
      return `BUSCAR: ${view.query.toUpperCase()}`
    case 'queue':
      return 'COLA'
    case 'playlist':
      return view.name.toUpperCase()
    case 'prompt':
      return view.label
    case 'context':
      return 'ACCIONES'
    case 'nowPlaying':
      return 'REPRODUCIENDO'
  }
}

const MENU_TITLES: Record<MenuId, string> = {
  root: 'WAVERR',
  folders: 'CARPETAS',
  recent: 'RECIENTES',
  favorites: 'FAVORITOS',
  playlists: 'PLAYLISTS',
  playlistPicker: 'A PLAYLIST',
  settings: 'AJUSTES'
}

async function buildItems(
  view: View,
  dispatch: (action: ScreenAction) => void,
  pendingTrackId: number | null
): Promise<ScreenItem[]> {
  switch (view.kind) {
    case 'nowPlaying':
      return []

    case 'menu':
      return buildMenuItems(view.menu, dispatch, pendingTrackId)

    case 'folder': {
      const tracks = await window.waverr.library.search({
        folderPath: view.path,
        sort: 'name',
        limit: LIST_LIMIT
      })
      return tracks.map(trackItem(tracks, dispatch))
    }

    case 'search': {
      const tracks = await window.waverr.library.search({
        query: view.query,
        sort: 'relevance',
        limit: LIST_LIMIT
      })
      return tracks.map(trackItem(tracks, dispatch))
    }

    case 'context':
      return buildContextItems(view.target, dispatch)

    case 'playlist': {
      const entries = await window.waverr.library.listPlaylistTracks(view.playlistId)
      if (entries.length === 0) return [emptyItem('PLAYLIST VACIA')]

      return entries.map((entry, index) => ({
        key: `item-${entry.itemId}`,
        label: `${entry.missing ? '! ' : ''}${displayName(entry)}`,
        meta: entry.durationMs ? formatTime(entry.durationMs) : entry.ext.slice(1).toUpperCase(),
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
        activate: () => {
          // Las perdidas se saltean: si la elegida no suena, arranca en la
          // primera reproducible que venga despues. Si no queda ninguna, no
          // arranca nada (y la pantalla no se va a NOW PLAYING de arriba).
          const startIndex = startIndexForEntry(entries, entry.itemId)
          if (startIndex === null) return
          dispatch({ type: 'openNowPlaying' })
          void audioEngine.playNow(
            entries.filter((candidate) => !candidate.missing),
            startIndex
          )
        }
      }))
    }

    case 'queue':
    case 'prompt':
      return []
  }
}

async function buildMenuItems(
  menu: string,
  dispatch: (action: ScreenAction) => void,
  pendingTrackId: number | null
): Promise<ScreenItem[]> {
  switch (menu) {
    case 'root':
      return ROOT_MENU.map((entry) => ({
        key: entry.id,
        label: entry.label,
        drillsDown: true,
        activate: () => dispatch({ type: 'push', view: entry.view })
      }))

    case 'folders': {
      const folders = await window.waverr.library.listFolders()
      if (folders.length === 0) return [emptyItem('SIN CARPETAS')]
      return folders.map((folder) => ({
        key: folder.path,
        label: folder.name.toUpperCase(),
        meta: String(folder.trackCount),
        drillsDown: true,
        activate: () =>
          dispatch({
            type: 'push',
            view: { kind: 'folder', path: folder.path, name: folder.name, selected: 0 }
          })
      }))
    }

    case 'recent': {
      const tracks = await window.waverr.library.search({ sort: 'recent', limit: LIST_LIMIT })
      if (tracks.length === 0) return [emptyItem('NADA TODAVIA')]
      return tracks.map(trackItem(tracks, dispatch))
    }

    case 'favorites': {
      const tracks = await window.waverr.library.search({
        onlyFavorites: true,
        sort: 'name',
        limit: LIST_LIMIT
      })
      if (tracks.length === 0) return [emptyItem('SIN FAVORITOS')]
      return tracks.map(trackItem(tracks, dispatch))
    }

    case 'playlists': {
      const playlists = await window.waverr.library.listPlaylists()
      const items: ScreenItem[] = [
        {
          key: 'new',
          label: '+ NUEVA PLAYLIST',
          activate: () =>
            dispatch({
              type: 'push',
              view: { kind: 'prompt', label: 'NOMBRE', value: '', intent: { kind: 'newPlaylist' } }
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
      // Submenu de AGREGAR A PLAYLIST. La pista objetivo viene de la vista
      // `context` que quedo abajo en la pila.
      const playlists = await window.waverr.library.listPlaylists()
      const items: ScreenItem[] = [
        {
          key: 'new',
          label: '+ NUEVA PLAYLIST',
          activate: () =>
            dispatch({
              type: 'push',
              view: {
                kind: 'prompt',
                label: 'NOMBRE',
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
            // Vuelve a la lista de donde se venia, sin quedar navegando
            // adentro de la playlist.
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
          label: '+ AGREGAR CARPETA',
          activate: async () => {
            await window.waverr.library.pickRoot()
          }
        },
        {
          key: 'rescan',
          label: 'RESCANEAR TODO',
          activate: async () => {
            await window.waverr.library.rescan()
          }
        },
        {
          key: 'stats',
          label: `${stats.trackCount} PISTAS`,
          meta: stats.missingCount > 0 ? `${stats.missingCount} PERDIDAS` : undefined,
          activate: () => {}
        }
      ]

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
 * Acciones sobre una fila. MOVER y QUITAR solo aparecen donde tienen sentido:
 * en la cola y adentro de una playlist.
 */
async function buildContextItems(
  target: ContextTarget,
  dispatch: (action: ScreenAction) => void
): Promise<ScreenItem[]> {
  const items: ScreenItem[] = []

  if (target.trackId !== undefined) {
    const trackId = target.trackId

    items.push({
      key: 'play',
      label: 'REPRODUCIR AHORA',
      activate: async () => {
        const track = await window.waverr.library.getTrack(trackId)
        if (!track) return
        dispatch({ type: 'back' })
        dispatch({ type: 'openNowPlaying' })
        void audioEngine.playNow([track], 0)
      }
    })

    items.push({
      key: 'next',
      label: 'ENCOLAR SIGUIENTE',
      activate: async () => {
        const track = await window.waverr.library.getTrack(trackId)
        if (track) audioEngine.enqueueNext(track)
        dispatch({ type: 'back' })
      }
    })

    items.push({
      key: 'last',
      label: 'ENCOLAR AL FINAL',
      activate: async () => {
        const track = await window.waverr.library.getTrack(trackId)
        if (track) audioEngine.enqueue(track)
        dispatch({ type: 'back' })
      }
    })

    items.push({
      key: 'playlist',
      label: 'AGREGAR A PLAYLIST',
      drillsDown: true,
      activate: () =>
        dispatch({
          type: 'push',
          view: { kind: 'menu', menu: 'playlistPicker', selected: 0 }
        })
    })

    items.push({
      key: 'favorite',
      label: 'FAVORITO',
      activate: async () => {
        await window.waverr.library.toggleFavorite(trackId)
        dispatch({ type: 'back' })
      }
    })
  }

  // Fila de una playlist en si misma (no una pista adentro): renombrar y borrar.
  if (target.playlistId !== undefined && target.trackId === undefined) {
    const playlistId = target.playlistId
    items.push({
      key: 'rename',
      label: 'RENOMBRAR',
      activate: () => {
        dispatch({ type: 'back' })
        dispatch({
          type: 'push',
          view: {
            kind: 'prompt',
            label: 'NUEVO NOMBRE',
            value: '',
            intent: { kind: 'renamePlaylist', playlistId }
          }
        })
      }
    })
    items.push({
      key: 'delete',
      label: 'BORRAR PLAYLIST',
      activate: async () => {
        await window.waverr.library.deletePlaylist(playlistId)
        dispatch({ type: 'back' })
      }
    })
  }

  if (target.origin === 'queue' || target.origin === 'playlist') {
    items.push({
      key: 'move',
      label: 'MOVER',
      activate: () => {
        dispatch({ type: 'back' })
        dispatch({ type: 'setSelection', index: target.index })
        dispatch({ type: 'startMove' })
      }
    })

    items.push({
      key: 'remove',
      label: 'QUITAR',
      activate: async () => {
        if (target.origin === 'queue') {
          audioEngine.removeFromQueue(target.index)
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
    meta: track.durationMs ? formatTime(track.durationMs) : track.ext.slice(1).toUpperCase(),
    trackId: track.id,
    favorite: track.favorite,
    contextTarget: {
      label: displayName(track),
      index,
      origin: 'library',
      trackId: track.id
    },
    activate: () => {
      // La pantalla cambia primero: cargar el audio puede tardar y la
      // navegacion no tiene por que quedarse esperandolo.
      dispatch({ type: 'openNowPlaying' })
      // La lista visible se convierte en la cola: asi NEXT sigue lo que se ve.
      void audioEngine.playNow(tracks, index)
    }
  })
}

function emptyItem(label: string): ScreenItem {
  return { key: 'empty', label, activate: () => {} }
}

/** Un export sin tags se muestra por su nombre de archivo, que es lo que el autor reconoce. */
export function displayName(track: Track): string {
  return track.hasTags && track.title ? track.title : track.filename
}

function shortenPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  return `...${parts.slice(-2).join('/')}`
}
