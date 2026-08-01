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

const FIXTURES = [
  'demos/idea_140bpm.wav',
  // Dos pistas mas, para el test de reordenar una playlist: hace falta mas
  // de un tema para que mover algo dentro de ella tenga sentido.
  'beats/trap/beat_v3.wav',
  'beats/house/loop_128bpm.wav'
]

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

test('MOVER reordena una playlist y el nuevo orden se reproduce', async () => {
  const rows = page.getByTestId('screen-row')

  // Arma una playlist propia de tres temas, agregando cada uno desde su
  // carpeta con AGREGAR A PLAYLIST -> la playlist ya existente. El orden de
  // insercion queda IDEA, BEAT_V3, LOOP_128BPM.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'CARPETAS' }).click()
  await rows.filter({ hasText: 'DEMOS' }).click()
  await rows.filter({ hasText: 'idea_140bpm' }).click({ button: 'right' })
  await rows.filter({ hasText: 'AGREGAR A PLAYLIST' }).click()
  await rows.filter({ hasText: '+ NUEVA PLAYLIST' }).click()
  await page.keyboard.type('EP nuevo')
  await page.keyboard.press('Enter')

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'CARPETAS' }).click()
  await rows.filter({ hasText: 'TRAP' }).click()
  await rows.filter({ hasText: 'beat_v3' }).click({ button: 'right' })
  await rows.filter({ hasText: 'AGREGAR A PLAYLIST' }).click()
  await rows.filter({ hasText: 'EP NUEVO' }).click()

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'CARPETAS' }).click()
  await rows.filter({ hasText: 'HOUSE' }).click()
  await rows.filter({ hasText: 'loop_128bpm' }).click({ button: 'right' })
  await rows.filter({ hasText: 'AGREGAR A PLAYLIST' }).click()
  await rows.filter({ hasText: 'EP NUEVO' }).click()

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'PLAYLISTS' }).click()
  await rows.filter({ hasText: 'EP NUEVO' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('EP NUEVO')
  // Se espera el contenido real de ESTA vista (no solo la cantidad de filas):
  // el titulo cambia en el mismo render que el `dispatch`, pero las filas
  // tardan un tick mas en cargar por IPC, y mientras tanto podrian quedar
  // dibujadas las tres filas de la vista PLAYLISTS anterior (+ NUEVA
  // PLAYLIST y las dos playlists), que por casualidad tambien suman 3.
  await expect(rows.nth(0)).toHaveText(/idea_140bpm/)
  await expect(rows.nth(1)).toHaveText(/beat_v3/)
  await expect(rows.nth(2)).toHaveText(/loop_128bpm/)
  await expect(rows).toHaveCount(3)

  // MOVER: agarra la primera fila (idea_140bpm) y la lleva al final.
  await rows.filter({ hasText: 'idea_140bpm' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACCIONES')
  await rows.filter({ hasText: 'MOVER' }).click()

  await expect(page.getByTestId('moving-banner')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('moving-banner')).not.toBeVisible()

  // El nuevo orden viene de releer la playlist por IPC (no es un cambio
  // solo visual): confirma que `movePlaylistItem` persistio el reordenamiento.
  await expect(rows.nth(0)).toHaveText(/beat_v3/)
  await expect(rows.nth(1)).toHaveText(/loop_128bpm/)
  await expect(rows.nth(2)).toHaveText(/idea_140bpm/)
  await expect(rows).toHaveCount(3)

  // Reproducirla arranca por la primera pista del orden NUEVO.
  await rows.first().click()
  await expect(page.getByTestId('now-playing')).toBeVisible()
  await expect(page.getByTestId('np-title')).toHaveText(/beat_v3/)
})
