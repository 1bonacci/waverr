import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ScanProgress, Track } from '@shared/types'
import { audioEngine } from '../audio/AudioEngine'
import { formatTime, usePlayback } from '../audio/usePlayback'
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
  /** Rotulo de seccion (AHORA/SIGUIENTE/LUEGO) para dibujar arriba de esta
   *  fila. No es una fila en si: no ocupa un indice ni se puede seleccionar. */
  sectionHeader?: string
  /** Fila de accion (GUARDAR COMO PLAYLIST, + NUEVA PLAYLIST) en vez de una
   *  pista: la aritmetica del modo mover la ignora, porque no es un lugar
   *  valido donde soltar ni algo que se pueda reordenar. */
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
  /** Ejecuta la fila seleccionada. */
  activate: () => void
  /** Suelta la fila agarrada en modo mover sobre la fila `index`. Es lo que
   *  usa un click de mouse (a diferencia de OK, que suelta donde ya estaba
   *  el arrastre). */
  dropAt: (index: number) => void
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
  // La vista COLA lee el motor directo, no la base: sin esto, encolar o
  // pasar a la siguiente pista no refrescaria lo que se ve.
  const playback = usePlayback()

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

  // La fila sobre la que se abrio el menu contextual actual, si la hay.
  // "REPRODUCIR AHORA" la reusa tal cual para heredar el mismo contexto
  // (la lista entera que se estaba mirando) que una activacion normal:
  // asi no colapsa a una lista de un solo tema.
  const contextRowActivateRef = useRef<(() => void | Promise<void>) | null>(null)

  useEffect(() => {
    const token = ++loadTokenRef.current
    let cancelled = false

    async function load(): Promise<void> {
      // La lista anterior se descarta de entrada: si se dejara dibujada
      // mientras carga la nueva, apretar OK rapido activaria la fila vieja.
      setItems([])
      setLoading(true)
      setPromptError(null)
      const next = await buildItems(view, dispatch, pendingTrackId, contextRowActivateRef.current)
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
    // `playback.track?.id` y `playback.manualCount` cubren la vista COLA: no
    // tiene una clave propia (`viewKey` es fijo, 'queue'), asi que sin esto no
    // se enteraria de que cambio AHORA o de que se encolo/saco algo a mano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, revision, pendingTrackId, playback.track?.id, playback.manualCount])

  // Cuantas filas cuentan para la aritmetica del modo mover: todo salvo las
  // filas de accion (GUARDAR COMO PLAYLIST). Sin este filtro el marcador
  // podria pararse sobre esa fila, que no es una pista ni un lugar valido
  // donde soltar.
  const movableRowCount = useMemo(() => items.filter((item) => !item.isAction).length, [items])

  // Suelta la fila agarrada en modo mover en la posicion `toIndex`, sin
  // importar si vino de OK (posicion ya guardada en `moving.to`) o de un
  // click (la fila que se toco). Comun a `activate` y `dropAt` para que el
  // mouse y el teclado sueltan exactamente igual.
  const performDrop = useCallback(
    (toIndex: number) => {
      const view_ = view
      if ((view_.kind !== 'queue' && view_.kind !== 'playlist') || !view_.moving) return

      const { from, originId, originOccurrence } = view_.moving
      const to = movableRowCount > 0 ? Math.max(0, Math.min(toIndex, movableRowCount - 1)) : 0

      if (view_.kind === 'queue') {
        // La lista pudo reconstruirse mientras se arrastraba (una pista que
        // termina consume la cola manual y corre los indices de fila): el
        // origen se resuelve por la identidad de la pista agarrada
        // (`originId` + `originOccurrence`, para desempatar si esta
        // encolada mas de una vez), no por el indice de fila que se guardo
        // al empezar.
        const rows = buildQueueRows(audioEngine.getQueueView())
        const originIndex = resolveManualIndexById(rows, originId, originOccurrence)
        // Si ya no esta (se consumio sola durante el arrastre) no hay nada
        // que mover: soltar no hace nada distinto de cancelar.
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
    // Con una fila agarrada, OK la suelta donde ya estaba en vez de activarla.
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
      // Con una fila agarrada, solo cuentan las filas de pista: el marcador
      // no se puede parar sobre GUARDAR COMO PLAYLIST.
      const moving = (view_.kind === 'queue' || view_.kind === 'playlist') && view_.moving !== null
      dispatch({ type: 'move', delta, itemCount: moving ? movableRowCount : items.length })
    },
    [items.length, movableRowCount, view]
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
    dropAt,
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
  pendingTrackId: number | null,
  contextRowActivate: (() => void | Promise<void>) | null
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
      return buildContextItems(view.target, dispatch, contextRowActivate)

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
            sectionHeader: 'AHORA',
            activate: () => dispatch({ type: 'openNowPlaying' })
          })
          continue
        }

        if (row.section === 'manual') {
          const manualIndex = row.manualIndex
          items.push({
            key: `manual-${manualIndex}-${row.track.id}`,
            label: displayName(row.track),
            meta: formatTime(row.track.durationMs ?? 0),
            // Rotulo solo en la primera fila de la seccion: no se repite en
            // cada pista encolada.
            sectionHeader: manualIndex === 0 ? 'SIGUIENTE' : undefined,
            trackId: row.track.id,
            favorite: row.track.favorite,
            contextTarget: {
              label: displayName(row.track),
              // El indice es dentro de la cola manual: es lo que entienden
              // moveInQueue y removeFromQueue. Sirve solo de referencia
              // inicial (ver comentario en ContextTarget): MOVER y QUITAR
              // resuelven por trackId + occurrence, no por este indice.
              index: manualIndex,
              origin: 'queue',
              trackId: row.track.id,
              // Encolar la misma pista dos veces esta permitido a proposito:
              // este ordinal es lo que permite distinguir esta copia de otra
              // igual si hay que volver a encontrarla despues.
              occurrence: occurrenceInManual(rows, manualIndex)
            },
            activate: () => {
              // Saltar directo a un encolado: las que quedaron antes en la
              // cola manual no se pierden, siguen ahi para sonar despues.
              dispatch({ type: 'openNowPlaying' })
              void audioEngine.skipToManual(manualIndex)
            }
          })
          continue
        }

        // LUEGO: nunca lleva contextTarget, asi que nunca ofrece MOVER/QUITAR.
        const upcomingIndex = row.upcomingIndex
        items.push({
          key: `upcoming-${upcomingIndex}-${row.track.id}`,
          label: displayName(row.track),
          meta: formatTime(row.track.durationMs ?? 0),
          sectionHeader: upcomingIndex === 0 ? 'LUEGO' : undefined,
          trackId: row.track.id,
          favorite: row.track.favorite,
          activate: () => {
            dispatch({ type: 'openNowPlaying' })
            void audioEngine.playNow(upcomingTracks, upcomingIndex)
          }
        })
      }

      if (items.length === 0) return [emptyItem('COLA VACIA')]

      items.push({
        key: 'save',
        label: 'GUARDAR COMO PLAYLIST',
        isAction: true,
        activate: () =>
          dispatch({
            type: 'push',
            view: { kind: 'prompt', label: 'NOMBRE', value: '', intent: { kind: 'saveQueue' } }
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
  dispatch: (action: ScreenAction) => void,
  contextRowActivate: (() => void | Promise<void>) | null
): Promise<ScreenItem[]> {
  const items: ScreenItem[] = []

  if (target.trackId !== undefined) {
    const trackId = target.trackId

    items.push({
      key: 'play',
      label: 'REPRODUCIR AHORA',
      activate: async () => {
        dispatch({ type: 'back' })
        // Reusa la activacion normal de la fila (la misma que corre un
        // click o un OK directo): hereda asi la lista de origen entera como
        // contexto, en vez de colapsarla a una sola pista.
        if (contextRowActivate) await contextRowActivate()
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

  // Fila de una playlist en si misma (no una pista adentro): reproducir,
  // renombrar y borrar.
  if (target.playlistId !== undefined && target.trackId === undefined) {
    const playlistId = target.playlistId

    items.push({
      key: 'play',
      label: 'REPRODUCIR',
      activate: async () => {
        const entries = await window.waverr.library.listPlaylistTracks(playlistId)
        const playable = entries.filter((entry) => !entry.missing)
        dispatch({ type: 'back' })
        // Playlist vacia o toda perdida: no hay donde arrancar.
        if (playable.length === 0) return
        dispatch({ type: 'openNowPlaying' })
        void audioEngine.playNow(playable, 0)
      }
    })

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
        // No hace falta un `setSelection` aca: `openContextMenu` ya dejo la
        // seleccion de la vista de abajo en la fila que se toco (long-press o
        // click derecho), y `back` no la toca. Reponerla con `target.index`
        // seria ademas incorrecto para la cola cuando hay fila AHORA: ese
        // indice es de dominio (posicion en la cola manual), no de fila, y
        // ambos difieren en uno justo en ese caso.
        //
        // La identidad que se guarda para soltar despues (`originId`) es el
        // itemId dentro de una playlist o el trackId dentro de la cola: lo
        // que sigue identificando a esta fila si la lista se reconstruye
        // mientras se esta arrastrando (por ejemplo, una pista que termina y
        // corre los indices de la cola manual). `originOccurrence` (0 en
        // playlist, donde itemId ya es unico) desempata si esa pista esta
        // encolada mas de una vez.
        const originId = target.origin === 'playlist' ? target.itemId : target.trackId
        if (originId === undefined) return
        dispatch({ type: 'back' })
        dispatch({ type: 'startMove', originId, originOccurrence: target.occurrence ?? 0 })
      }
    })

    items.push({
      key: 'remove',
      label: 'QUITAR',
      activate: async () => {
        if (target.origin === 'queue') {
          // No se usa `target.index`: si la pista actual termino con el menu
          // ACCIONES abierto, ese indice quedo viejo y sacaria la fila
          // equivocada (justo lo que la invariante de la cola prohibe: nada
          // que el usuario encolo desaparece salvo que el lo saque). Se
          // resuelve de nuevo por identidad, igual que MOVER.
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
