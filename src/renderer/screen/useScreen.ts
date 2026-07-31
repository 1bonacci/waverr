import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ScanProgress, Track } from '@shared/types'
import { audioEngine } from '../audio/AudioEngine'
import { formatTime } from '../audio/usePlayback'
import {
  currentSelection,
  currentView,
  INITIAL_SCREEN_STATE,
  screenReducer,
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

  const view = currentView(state)
  const selected = currentSelection(state)

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
      const next = await buildItems(view, dispatch)
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
  }, [viewKey, revision])

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
    toggleFavorite
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
  dispatch: (action: ScreenAction) => void
): Promise<ScreenItem[]> {
  switch (view.kind) {
    case 'nowPlaying':
      return []

    case 'menu':
      return buildMenuItems(view.menu, dispatch)

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

    case 'queue':
    case 'playlist':
    case 'prompt':
    case 'context':
      return []
  }
}

async function buildMenuItems(
  menu: string,
  dispatch: (action: ScreenAction) => void
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

    case 'playlists':
    case 'playlistPicker':
      return [emptyItem('VACIO')]

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
