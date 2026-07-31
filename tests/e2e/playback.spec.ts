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
 * Smoke end-to-end sobre la app ya construida (`npm run build` antes).
 *
 * Cubre lo que ninguna prueba unitaria puede: indice -> protocolo waverr:// ->
 * elemento <audio> -> AnalyserNode -> canvas, manejando el aparato como lo
 * manejaria una persona.
 */

const FIXTURES = [
  'beats/trap/beat_v3.wav',
  'beats/house/loop_128bpm.wav',
  'demos/idea_140bpm.wav'
]

/** Los fixtures duran lo suficiente como para observarlos sonando. */
const FIXTURE_SECONDS = 5

let app: ElectronApplication
let page: Page
let mediaRoot: string
let userDataDir: string

test.beforeAll(async () => {
  mediaRoot = await createTempLibrary(FIXTURES, FIXTURE_SECONDS)
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

test('el menu raiz arranca en CARPETAS', async () => {
  await expect(page.getByTestId('screen-title')).toHaveText('WAVERR')
  const rows = page.getByTestId('screen-row')
  await expect(rows.first()).toHaveText(/CARPETAS/)
  await expect(rows.first()).toHaveAttribute('data-selected', 'true')
})

test('se navega hasta una pista usando solo el teclado', async () => {
  const rows = page.getByTestId('screen-row')
  await page.keyboard.press('Home')

  // Cada nivel se carga de la base, asi que se espera el contenido de la lista
  // antes de seguir bajando: CARPETAS -> primera carpeta -> primera pista.
  await expect(rows.first()).toHaveText(/CARPETAS/)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('screen-title')).toHaveText('CARPETAS')
  await expect(rows.first()).toHaveText(/DEMOS/)
  await page.keyboard.press('Enter')

  await expect(rows.first()).toHaveText(/\.wav/)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('now-playing')).toBeVisible()
  await expect(page.getByTestId('np-title')).toHaveText(/\.wav$/)
})

/** Indicador de reproduccion que dibuja la LCD. */
const PLAYING = '▶'

test('el analizador recibe audio y el visualizador dibuja', async () => {
  await expect(page.getByTestId('screen-status')).toHaveText(PLAYING, { timeout: 15000 })

  // Si el MediaElementSource quedara "tainted", el analizador devolveria cero
  // fijo con el audio igual sonando: esto es lo que lo detecta.
  await expect
    .poll(async () => Number(await page.getByTestId('visualizer').getAttribute('data-peak')), {
      timeout: 15000,
      message: 'el AnalyserNode nunca recibio audio'
    })
    .toBeGreaterThan(0)
})

test('V cicla los modos del visualizador', async () => {
  const canvas = page.getByTestId('visualizer')
  await expect(canvas).toHaveAttribute('data-mode', 'bars')

  await page.keyboard.press('v')
  await expect(canvas).toHaveAttribute('data-mode', 'scope')

  await page.keyboard.press('v')
  await expect(canvas).toHaveAttribute('data-mode', 'ambient')

  await page.keyboard.press('v')
  await expect(canvas).toHaveAttribute('data-mode', 'bars')
})

test('tipear en cualquier lado abre la busqueda y filtra en vivo', async () => {
  await page.keyboard.press('Home')
  await page.keyboard.type('bpm')

  await expect(page.getByTestId('screen-title')).toHaveText(/BUSCAR: BPM/)
  await expect(page.getByTestId('screen-row')).toHaveCount(2, { timeout: 10000 })

  // Backspace borra letras; con la busqueda vacia, sale de la busqueda.
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('screen-title')).toHaveText(/BUSCAR: BP/)

  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('screen-title')).toHaveText('WAVERR')
})

test('F marca un favorito y aparece en FAVORITOS', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await expect(rows.first()).toHaveText(/CARPETAS/)
  await page.keyboard.press('Enter')
  await expect(rows.first()).toHaveText(/DEMOS/)
  await page.keyboard.press('Enter')
  await expect(rows.first()).toHaveText(/idea_140bpm/)

  await page.keyboard.press('f')
  await expect(rows.first()).toHaveText(/★/)

  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('screen-title')).toHaveText('FAVORITOS')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toHaveText(/idea_140bpm/)
})

test('espacio pausa y reanuda', async () => {
  await page.keyboard.press('Space')
  await expect(page.getByTestId('screen-status')).toHaveText('||', { timeout: 10000 })

  await page.keyboard.press('Space')
  await expect(page.getByTestId('screen-status')).toHaveText(PLAYING, { timeout: 10000 })
})
