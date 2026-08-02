import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type ScanProgress, type TrackQuery } from '../shared/types'
import type { Library } from './library/index'

/** Minimum gap between progress notices. Without it the scan floods the IPC. */
const PROGRESS_THROTTLE_MS = 120

export function registerWindowIpc(): void {
  ipcMain.on(IPC.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on(IPC.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

export function registerLibraryIpc(library: Library, getWindow: () => BrowserWindow | null): void {
  const emitProgress = throttle((progress: ScanProgress) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC.libraryScanProgress, progress)
    }
  }, PROGRESS_THROTTLE_MS)

  ipcMain.handle(IPC.libraryListRoots, () => library.listRoots())

  ipcMain.handle(IPC.libraryPickRoot, async () => {
    const window = getWindow()
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Choose a music folder',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })

    const chosen = result.filePaths[0]
    if (result.canceled || !chosen) return null

    const root = await library.addRoot(chosen)
    if (root) void scanInBackground(library, emitProgress)
    return root
  })

  ipcMain.handle(IPC.libraryAddRoot, async (_event, path: string) => {
    const root = await library.addRoot(path)
    if (root) void scanInBackground(library, emitProgress)
    return root
  })

  ipcMain.handle(IPC.libraryRemoveRoot, (_event, rootId: number) => {
    library.removeRoot(rootId)
  })

  ipcMain.handle(IPC.libraryRescan, () => library.scanAll(emitProgress))

  ipcMain.handle(IPC.librarySearch, (_event, query: TrackQuery) => library.search(query))
  ipcMain.handle(IPC.libraryListTracks, (_event, query: TrackQuery) => library.search(query))
  ipcMain.handle(IPC.libraryGetTrack, (_event, trackId: number) => library.getTrack(trackId))
  ipcMain.handle(IPC.libraryStats, () => library.stats())
  ipcMain.handle(IPC.libraryToggleFavorite, (_event, trackId: number) =>
    library.toggleFavorite(trackId)
  )
  ipcMain.handle(IPC.librarySetTrackHidden, (_event, trackId: number, hidden: boolean) =>
    library.setTrackHidden(trackId, hidden)
  )

  ipcMain.handle(IPC.libraryListPlaylists, () => library.listPlaylists())
  ipcMain.handle(IPC.libraryCreatePlaylist, (_event, name: string) => library.createPlaylist(name))
  ipcMain.handle(IPC.libraryRenamePlaylist, (_event, id: number, name: string) =>
    library.renamePlaylist(id, name)
  )
  ipcMain.handle(IPC.libraryDeletePlaylist, (_event, id: number) => library.deletePlaylist(id))
  ipcMain.handle(IPC.libraryAddToPlaylist, (_event, playlistId: number, trackId: number) =>
    library.addToPlaylist(playlistId, trackId)
  )
  ipcMain.handle(IPC.libraryRemoveFromPlaylist, (_event, itemId: number) =>
    library.removeFromPlaylist(itemId)
  )
  ipcMain.handle(IPC.libraryListPlaylistTracks, (_event, playlistId: number) =>
    library.listPlaylistTracks(playlistId)
  )
  ipcMain.handle(IPC.libraryMovePlaylistItem, (_event, playlistId: number, from: number, to: number) =>
    library.movePlaylistItem(playlistId, from, to)
  )
  ipcMain.handle(IPC.libraryCreatePlaylistFromTracks, (_event, name: string, trackIds: number[]) =>
    library.createPlaylistFromTracks(name, trackIds)
  )
  ipcMain.handle(IPC.libraryGetSetting, (_event, key: string) => library.getSetting(key))
  ipcMain.handle(IPC.librarySetSetting, (_event, key: string, value: string) =>
    library.setSetting(key, value)
  )
}

/**
 * A scan triggered by the user: the IPC reply does not wait for the result,
 * because the screen already shows the progress while it runs.
 */
export async function scanInBackground(
  library: Library,
  onProgress: (progress: ScanProgress) => void
): Promise<void> {
  try {
    await library.scanAll(onProgress)
  } catch (error) {
    console.error('[waverr] scan failed:', error)
  }
}

function throttle<T>(fn: (value: T) => void, waitMs: number): (value: T) => void {
  let lastRun = 0
  return (value: T) => {
    const now = Date.now()
    // Terminal phases always get through: they are what clears the notice.
    const isTerminal = typeof value === 'object' && value !== null && 'phase' in value
      ? (value as { phase: string }).phase === 'done'
      : false

    if (isTerminal || now - lastRun >= waitMs) {
      lastRun = now
      fn(value)
    }
  }
}
