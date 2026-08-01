import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerLibraryIpc, registerWindowIpc, scanInBackground } from './ipc'
import { Library } from './library/index'
import { registerMediaProtocol, registerMediaScheme } from './media-protocol'
import { IPC } from '../shared/types'

// Tiene que correr antes de que la app este lista: despues de ese punto,
// registrar privilegios de esquema ya no tiene efecto.
registerMediaScheme()

/**
 * Medidas del chasis. La ventana no se redimensiona: el chasis ES la ventana,
 * asi que estos numeros son tambien las medidas del "hardware" dibujado.
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
    // Matches --chassis-edge in tokens.css: anything else flashes the wrong
    // color before the renderer paints.
    backgroundColor: '#c6c9cf',
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

  // Cualquier link externo abre en el navegador del sistema, nunca dentro de la app.
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

// Una sola instancia: abrir waverr dos veces enfoca la ventana existente
// en lugar de levantar un segundo proceso peleando por la misma base de datos.
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

    // Rescaneo incremental al arrancar: detecta lo que cambio en disco mientras
    // la app estaba cerrada. Corre en segundo plano para no demorar la ventana.
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
