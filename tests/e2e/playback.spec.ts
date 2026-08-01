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
  'demos/idea_140bpm.wav',
  // Carpeta aparte para el test de COLA: dos pistas propias para armar un
  // AHORA + LUEGO que no se pisen con las que se encolan a mano (si
  // compartieran nombre con beat_v3/loop_128bpm, la vista COLA las mostraria
  // dos veces y los `hasText` de las aserciones dejarian de ser unicos).
  'upcoming/context_a.wav',
  'upcoming/context_b.wav'
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

test('MOVER reordena la cola manual y LUEGO nunca lo ofrece', async () => {
  const rows = page.getByTestId('screen-row')

  // Cola manual: dos pistas por ENCOLAR AL FINAL, en el orden en que se
  // encolan (TRAP primero, HOUSE despues).
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'CARPETAS' }).click()
  await rows.filter({ hasText: 'TRAP' }).click()
  await expect(rows.first()).toHaveText(/beat_v3/)
  await rows.first().click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACCIONES')
  await rows.filter({ hasText: 'ENCOLAR AL FINAL' }).click()

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'CARPETAS' }).click()
  await rows.filter({ hasText: 'HOUSE' }).click()
  await expect(rows.first()).toHaveText(/loop_128bpm/)
  await rows.first().click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACCIONES')
  await rows.filter({ hasText: 'ENCOLAR AL FINAL' }).click()

  // AHORA + LUEGO: un contexto propio de dos pistas (UPCOMING), que no
  // comparte nombres con lo que se acaba de encolar a mano.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'CARPETAS' }).click()
  await rows.filter({ hasText: 'UPCOMING' }).click()
  await expect(rows.first()).toHaveText(/context_a/)
  await rows.first().click()
  await expect(page.getByTestId('now-playing')).toBeVisible()

  // COLA: AHORA=context_a, MANUAL=[beat_v3, loop_128bpm], LUEGO=[context_b],
  // mas la fila GUARDAR COMO PLAYLIST al final (5 en total).
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'COLA' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('COLA')
  await expect(rows).toHaveCount(5)

  const before = await rows.allTextContents()
  const beatBefore = before.findIndex((text) => text.includes('beat_v3'))
  const loopBefore = before.findIndex((text) => text.includes('loop_128bpm'))
  expect(beatBefore).toBeGreaterThanOrEqual(0)
  expect(loopBefore).toBeGreaterThan(beatBefore)

  // MOVER: agarrar la primera de la cola manual (beat_v3) y bajarla una
  // posicion con el teclado, como si arrastrara sobre loop_128bpm.
  await rows.filter({ hasText: 'beat_v3' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACCIONES')
  await rows.filter({ hasText: 'MOVER' }).click()

  await expect(page.getByTestId('moving-banner')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('moving-banner')).not.toBeVisible()
  await expect(rows).toHaveCount(5)

  const after = await rows.allTextContents()
  const beatAfter = after.findIndex((text) => text.includes('beat_v3'))
  const loopAfter = after.findIndex((text) => text.includes('loop_128bpm'))
  // Se soltó una fila más abajo: loop_128bpm paso a la punta de la cola
  // manual y beat_v3 quedo justo despues.
  expect(loopAfter).toBeLessThan(beatAfter)

  // LUEGO (context_b, lo unico que queda del contexto) nunca ofrece MOVER: ni
  // siquiera abre el menu contextual, porque esa fila no lleva
  // `contextTarget` (a diferencia de una fila de la cola manual, que si lo
  // lleva y por eso recien arriba pudo abrir ACCIONES).
  await rows.filter({ hasText: 'context_b' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('COLA')
  await expect(rows.filter({ hasText: 'MOVER' })).toHaveCount(0)
})

test('GUARDAR COMO PLAYLIST convierte la cola en una playlist que se puede reproducir', async () => {
  const rows = page.getByTestId('screen-row')

  // Retoma la COLA armada por el test anterior: AHORA + 2 manuales + 1 LUEGO,
  // 4 pistas en total.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'COLA' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('COLA')

  await rows.filter({ hasText: 'GUARDAR COMO PLAYLIST' }).click()
  await expect(page.getByTestId('prompt')).toBeVisible()
  await page.keyboard.type('Sesion buena')
  await page.keyboard.press('Enter')

  // El prompt no lleva a ningun lado especial (a diferencia del picker de
  // AGREGAR A PLAYLIST): se vuelve a ver la COLA de donde salio.
  await expect(page.getByTestId('screen-title')).toHaveText('COLA')

  const playlists = await page.evaluate(() => window.waverr.library.listPlaylists())
  const saved = playlists.find((playlist) => playlist.name === 'Sesion buena')
  expect(saved).toBeDefined()
  expect(saved?.trackCount).toBe(4)

  // Se puede reproducir como cualquier otra playlist desde PLAYLISTS.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'PLAYLISTS' }).click()
  await rows.filter({ hasText: 'SESION BUENA' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('SESION BUENA')
  await expect(rows).toHaveCount(4)

  await rows.first().click()
  await expect(page.getByTestId('now-playing')).toBeVisible()
})

test('nombre de playlist repetido en GUARDAR COMO PLAYLIST avisa y no crea otra', async () => {
  const rows = page.getByTestId('screen-row')

  const before = await page.evaluate(() => window.waverr.library.listPlaylists())
  const beforeCount = before.filter((playlist) => playlist.name === 'Sesion buena').length
  expect(beforeCount).toBe(1)

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'COLA' }).click()
  await rows.filter({ hasText: 'GUARDAR COMO PLAYLIST' }).click()
  await expect(page.getByTestId('prompt')).toBeVisible()
  await page.keyboard.type('Sesion buena')
  await page.keyboard.press('Enter')

  // El prompt sigue abierto mostrando el aviso, no se vuelve a la COLA.
  await expect(page.getByTestId('prompt')).toBeVisible()
  await expect(page.getByTestId('prompt')).toContainText('YA EXISTE')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('screen-title')).toHaveText('COLA')

  const after = await page.evaluate(() => window.waverr.library.listPlaylists())
  expect(after.filter((playlist) => playlist.name === 'Sesion buena').length).toBe(1)
})
