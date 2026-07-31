import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { createTempLibrary } from '../unit/helpers/audio-fixtures'

/**
 * Cubre el camino completo de "AGREGAR A PLAYLIST" -> "+ NUEVA PLAYLIST":
 * que el usuario vuelva a la lista de origen (no al menu contextual que ya
 * daba por cerrado), y que la playlist se haya creado con la pista adentro.
 */

const FIXTURES = ['demos/idea_140bpm.wav']

let app: ElectronApplication
let page: Page
let mediaRoot: string
let userDataDir: string

test.beforeAll(async () => {
  mediaRoot = await createTempLibrary(FIXTURES)
  userDataDir = await mkdtemp(join(tmpdir(), 'waverr-e2e-userdata-'))

  // El host de VSCode exporta ELECTRON_RUN_AS_NODE=1, que haria arrancar a
  // Electron como Node puro y sin ventana. Se limpia para este proceso.
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) env[key] = value
  }

  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
  page = await app.firstWindow()

  await page.waitForSelector('[data-testid="screen-title"]')
  await page.evaluate((root: string) => window.waverr.library.addRoot(root), mediaRoot)

  // El escaneo corre en segundo plano; la pantalla se refresca al terminar.
  await expect(page.getByTestId('screen-status')).toHaveText('', { timeout: 30000 })
})

test.afterAll(async () => {
  await app?.close()
  await rm(mediaRoot, { recursive: true, force: true }).catch(() => {})
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
})

test('crear una playlist desde el picker de AGREGAR A PLAYLIST vuelve a la lista de origen', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await expect(rows.first()).toHaveText(/CARPETAS/)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('screen-title')).toHaveText('CARPETAS')
  await expect(rows.first()).toHaveText(/DEMOS/)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('screen-title')).toHaveText('DEMOS')
  await expect(rows.first()).toHaveText(/idea_140bpm/)

  // Menu contextual con click derecho: la via que tiene quien no usa teclado.
  await rows.first().click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACCIONES')

  await rows.filter({ hasText: 'AGREGAR A PLAYLIST' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('A PLAYLIST')

  await rows.filter({ hasText: '+ NUEVA PLAYLIST' }).click()
  await expect(page.getByTestId('prompt')).toBeVisible()

  // El nombre lleva V y F a proposito: son letras con atajo global (visualizer,
  // favorito) fuera del prompt, y tienen que escribirse igual que cualquier otra.
  await page.keyboard.type('Favoritas del viernes')
  await expect(page.getByTestId('prompt-value')).toHaveText(/Favoritas del viernes/)
  await page.keyboard.press('Enter')

  // Ni el picker ni el menu contextual quedan colgados debajo: se vuelve a
  // la carpeta de origen, viendo la pista de nuevo (no "ACCIONES").
  await expect(page.getByTestId('screen-title')).toHaveText('DEMOS')
  await expect(rows.first()).toHaveText(/idea_140bpm/)

  // La playlist se creo de verdad, con la pista adentro.
  const playlists = await page.evaluate(() => window.waverr.library.listPlaylists())
  expect(playlists).toHaveLength(1)
  expect(playlists[0]?.name).toBe('Favoritas del viernes')
  expect(playlists[0]?.trackCount).toBe(1)
})
