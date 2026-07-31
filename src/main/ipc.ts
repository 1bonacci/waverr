import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type ScanProgress, type TrackQuery } from '../shared/types'
import type { Library } from './library/index'

/** Minimo entre avisos de progreso. Sin esto el escaneo inunda el IPC. */
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
          title: 'Elegir carpeta de musica',
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
  ipcMain.handle(IPC.libraryListFolders, () => library.listFolders())
  ipcMain.handle(IPC.libraryGetTrack, (_event, trackId: number) => library.getTrack(trackId))
  ipcMain.handle(IPC.libraryStats, () => library.stats())
  ipcMain.handle(IPC.libraryToggleFavorite, (_event, trackId: number) =>
    library.toggleFavorite(trackId)
  )
}

/**
 * Escaneo disparado por el usuario: no se espera el resultado para responder el
 * IPC, porque la pantalla ya muestra el progreso mientras corre.
 */
export async function scanInBackground(
  library: Library,
  onProgress: (progress: ScanProgress) => void
): Promise<void> {
  try {
    await library.scanAll(onProgress)
  } catch (error) {
    console.error('[waverr] fallo el escaneo:', error)
  }
}

function throttle<T>(fn: (value: T) => void, waitMs: number): (value: T) => void {
  let lastRun = 0
  return (value: T) => {
    const now = Date.now()
    // Las fases terminales siempre pasan: son las que apagan el cartel.
    const isTerminal = typeof value === 'object' && value !== null && 'phase' in value
      ? (value as { phase: string }).phase === 'done'
      : false

    if (isTerminal || now - lastRun >= waitMs) {
      lastRun = now
      fn(value)
    }
  }
}
