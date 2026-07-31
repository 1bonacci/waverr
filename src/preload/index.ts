import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Root,
  type ScanProgress,
  type TrackQuery,
  type WaverrApi
} from '../shared/types'

/**
 * Unico puente entre el renderer y el sistema. El renderer nunca ve `fs`,
 * `path` ni `ipcRenderer` crudo: solo estos metodos.
 */
const api: WaverrApi = {
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    close: () => ipcRenderer.send(IPC.windowClose)
  },
  library: {
    listRoots: () => ipcRenderer.invoke(IPC.libraryListRoots),
    pickRoot: () => ipcRenderer.invoke(IPC.libraryPickRoot) as Promise<Root | null>,
    addRoot: (path: string) => ipcRenderer.invoke(IPC.libraryAddRoot, path) as Promise<Root | null>,
    removeRoot: (rootId: number) => ipcRenderer.invoke(IPC.libraryRemoveRoot, rootId),
    rescan: () => ipcRenderer.invoke(IPC.libraryRescan),
    search: (query: TrackQuery) => ipcRenderer.invoke(IPC.librarySearch, query),
    listFolders: () => ipcRenderer.invoke(IPC.libraryListFolders),
    listTracks: (query: TrackQuery) => ipcRenderer.invoke(IPC.libraryListTracks, query),
    getTrack: (trackId: number) => ipcRenderer.invoke(IPC.libraryGetTrack, trackId),
    stats: () => ipcRenderer.invoke(IPC.libraryStats),
    toggleFavorite: (trackId: number) =>
      ipcRenderer.invoke(IPC.libraryToggleFavorite, trackId) as Promise<boolean>,
    listPlaylists: () => ipcRenderer.invoke(IPC.libraryListPlaylists),
    createPlaylist: (name: string) => ipcRenderer.invoke(IPC.libraryCreatePlaylist, name),
    renamePlaylist: (playlistId: number, name: string) =>
      ipcRenderer.invoke(IPC.libraryRenamePlaylist, playlistId, name),
    deletePlaylist: (playlistId: number) =>
      ipcRenderer.invoke(IPC.libraryDeletePlaylist, playlistId),
    addToPlaylist: (playlistId: number, trackId: number) =>
      ipcRenderer.invoke(IPC.libraryAddToPlaylist, playlistId, trackId),
    removeFromPlaylist: (itemId: number) =>
      ipcRenderer.invoke(IPC.libraryRemoveFromPlaylist, itemId),
    listPlaylistTracks: (playlistId: number) =>
      ipcRenderer.invoke(IPC.libraryListPlaylistTracks, playlistId),
    movePlaylistItem: (playlistId: number, from: number, to: number) =>
      ipcRenderer.invoke(IPC.libraryMovePlaylistItem, playlistId, from, to),
    createPlaylistFromTracks: (name: string, trackIds: number[]) =>
      ipcRenderer.invoke(IPC.libraryCreatePlaylistFromTracks, name, trackIds),
    getSetting: (key: string) => ipcRenderer.invoke(IPC.libraryGetSetting, key),
    setSetting: (key: string, value: string) =>
      ipcRenderer.invoke(IPC.librarySetSetting, key, value),
    onScanProgress: (listener: (progress: ScanProgress) => void) => {
      const handler = (_event: unknown, progress: ScanProgress): void => listener(progress)
      ipcRenderer.on(IPC.libraryScanProgress, handler)
      return () => ipcRenderer.removeListener(IPC.libraryScanProgress, handler)
    }
  }
}

contextBridge.exposeInMainWorld('waverr', api)
