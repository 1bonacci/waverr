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
    onScanProgress: (listener: (progress: ScanProgress) => void) => {
      const handler = (_event: unknown, progress: ScanProgress): void => listener(progress)
      ipcRenderer.on(IPC.libraryScanProgress, handler)
      return () => ipcRenderer.removeListener(IPC.libraryScanProgress, handler)
    }
  }
}

contextBridge.exposeInMainWorld('waverr', api)
