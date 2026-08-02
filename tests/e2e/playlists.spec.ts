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
 * Covers the full "ADD TO PLAYLIST" -> "+ NEW PLAYLIST" path: that the user
 * lands back on the list they came from (not on the context menu they already
 * considered closed), and that the playlist really was created with the track
 * in it.
 */

const FIXTURES = [
  'demos/idea_140bpm.wav',
  // Two more tracks for the playlist reordering test: moving something inside
  // a playlist only means anything with more than one track in it.
  'beats/trap/beat_v3.wav',
  'beats/house/loop_128bpm.wav'
]

/**
 * ALL TRACKS is sorted by folder, then A-Z inside each folder, so with these
 * fixtures the flat list is always:
 *
 *   0  idea_140bpm.wav   demos
 *   1  loop_128bpm.wav   house
 *   2  beat_v3.wav       trap
 */

let app: ElectronApplication
let page: Page
let mediaRoot: string
let userDataDir: string

test.beforeAll(async () => {
  mediaRoot = await createTempLibrary(FIXTURES)
  userDataDir = await mkdtemp(join(tmpdir(), 'waverr-e2e-userdata-'))

  // The VS Code host exports ELECTRON_RUN_AS_NODE=1, which would start Electron
  // as plain Node with no window. Clear it for this process.
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) env[key] = value
  }

  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
  page = await app.firstWindow()

  await page.waitForSelector('[data-testid="screen-title"]')
  await page.evaluate((root: string) => window.waverr.library.addRoot(root), mediaRoot)

  // The scan runs in the background; the screen refreshes when it finishes.
  await expect(page.getByTestId('screen-status')).toHaveText('', { timeout: 30000 })
})

test.afterAll(async () => {
  await app?.close()
  await rm(mediaRoot, { recursive: true, force: true }).catch(() => {})
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
})

test('creating a playlist from the ADD TO PLAYLIST picker returns to the list it came from', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await expect(rows.first()).toHaveText(/ALL TRACKS/)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('screen-title')).toHaveText('ALL TRACKS')
  await expect(rows.first()).toHaveText(/idea_140bpm/)

  // Context menu with a right click: the route for someone not using the
  // keyboard.
  await rows.first().click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACTIONS')

  await rows.filter({ hasText: 'ADD TO PLAYLIST' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('ADD TO PLAYLIST')

  await rows.filter({ hasText: '+ NEW PLAYLIST' }).click()
  await expect(page.getByTestId('prompt')).toBeVisible()

  // The name deliberately contains V and F: outside the prompt those letters
  // are global shortcuts (visualizer, favorite), and they have to type like any
  // other character inside it.
  await page.keyboard.type('Friday favorites')
  await expect(page.getByTestId('prompt-value')).toHaveText(/Friday favorites/)
  await page.keyboard.press('Enter')

  // Neither the picker nor the context menu is left dangling underneath: the
  // user is back on the list they started from, seeing the track again (not
  // "ACTIONS").
  await expect(page.getByTestId('screen-title')).toHaveText('ALL TRACKS')
  await expect(rows.first()).toHaveText(/idea_140bpm/)

  // The playlist really was created, with the track in it.
  const playlists = await page.evaluate(() => window.waverr.library.listPlaylists())
  expect(playlists).toHaveLength(1)
  expect(playlists[0]?.name).toBe('Friday favorites')
  expect(playlists[0]?.trackCount).toBe(1)
})

test('MOVE reorders a playlist and the new order is what plays', async () => {
  const rows = page.getByTestId('screen-row')

  // Builds its own three-track playlist, adding each one from the flat list
  // with ADD TO PLAYLIST. Insertion order ends up idea, beat_v3, loop_128bpm.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await rows.filter({ hasText: 'idea_140bpm' }).click({ button: 'right' })
  await rows.filter({ hasText: 'ADD TO PLAYLIST' }).click()
  await rows.filter({ hasText: '+ NEW PLAYLIST' }).click()
  await page.keyboard.type('New EP')
  await page.keyboard.press('Enter')

  await rows.filter({ hasText: 'beat_v3' }).click({ button: 'right' })
  await rows.filter({ hasText: 'ADD TO PLAYLIST' }).click()
  await rows.filter({ hasText: 'NEW EP' }).click()

  await rows.filter({ hasText: 'loop_128bpm' }).click({ button: 'right' })
  await rows.filter({ hasText: 'ADD TO PLAYLIST' }).click()
  await rows.filter({ hasText: 'NEW EP' }).click()

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'PLAYLISTS' }).click()
  await rows.filter({ hasText: 'NEW EP' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('NEW EP')
  // Waits for the real content of THIS view, not just a row count: the title
  // changes in the same render as the dispatch, but the rows take another tick
  // to arrive over IPC, and until then the three rows of the previous PLAYLISTS
  // view (+ NEW PLAYLIST and the two playlists) could still be drawn -- which
  // happen to also add up to 3.
  await expect(rows.nth(0)).toHaveText(/idea_140bpm/)
  await expect(rows.nth(1)).toHaveText(/beat_v3/)
  await expect(rows.nth(2)).toHaveText(/loop_128bpm/)
  await expect(rows).toHaveCount(3)

  // MOVE: grab the first row (idea_140bpm) and take it to the end.
  await rows.filter({ hasText: 'idea_140bpm' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACTIONS')
  await rows.filter({ hasText: /^MOVE$/ }).click()

  await expect(page.getByTestId('moving-banner')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('moving-banner')).not.toBeVisible()

  // The new order comes from re-reading the playlist over IPC (it is not just a
  // visual change): this confirms `movePlaylistItem` persisted the reordering.
  await expect(rows.nth(0)).toHaveText(/beat_v3/)
  await expect(rows.nth(1)).toHaveText(/loop_128bpm/)
  await expect(rows.nth(2)).toHaveText(/idea_140bpm/)
  await expect(rows).toHaveCount(3)

  // Playing it starts from the first track of the NEW order. Selecting a track
  // does not leave the list, so the visualizer is opened from the header.
  await rows.first().click()
  await page.getByTestId('now-playing-button').click()
  await expect(page.getByTestId('now-playing')).toBeVisible()
  await expect(page.getByTestId('np-title')).toHaveText(/beat_v3/)
})
