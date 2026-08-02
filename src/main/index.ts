import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerLibraryIpc, registerWindowIpc, scanInBackground } from './ipc'
import { Library } from './library/index'
import { registerMediaProtocol, registerMediaScheme } from './media-protocol'
import { IPC } from '../shared/types'

// Has to run before the app is ready: past that point, registering scheme
// privileges has no effect.
registerMediaScheme()

/**
 * Chassis dimensions. The window does not resize: the chassis IS the window, so
 * these numbers are also the dimensions of the drawn "hardware".
 */
const CHASSIS_WIDTH = 420
const CHASSIS_HEIGHT = 700

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let library: Library | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: CHASSIS_WIDTH,
    height: CHASSIS_HEIGHT,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    // The chassis draws its own rounded corners, so the window behind it has
    // to be see-through for them to read as corners rather than as a lighter
    // shape on a grey square. The trade is that there is no opaque background
    // colour left to cover the gap before the renderer's first paint; `show`
    // is already false until `ready-to-show`, which is what hides it instead.
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    title: 'waverr',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  // Any external link opens in the system browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

// A single instance: opening waverr twice focuses the existing window instead
// of starting a second process fighting over the same database.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    library = Library.open(join(app.getPath('userData'), 'waverr.db'))

    registerWindowIpc()
    registerLibraryIpc(library, () => mainWindow)
    registerMediaProtocol(library)

    mainWindow = createWindow()

    // Incremental rescan on startup: picks up whatever changed on disk while
    // the app was closed. Runs in the background so it does not delay the
    // window.
    mainWindow.webContents.once('did-finish-load', () => {
      if (!library) return
      void scanInBackground(library, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.libraryScanProgress, progress)
        }
      })
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('will-quit', () => {
    library?.close()
    library = null
  })
}
