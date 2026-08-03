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
 * End-to-end smoke test against the built app (run `npm run build` first).
 *
 * Covers what no unit test can: index -> waverr:// protocol -> <audio> element
 * -> AnalyserNode -> canvas, driving the device the way a person would.
 */

const FIXTURES = [
  'beats/trap/beat_v3.wav',
  'beats/house/loop_128bpm.wav',
  'demos/idea_140bpm.wav',
  // Its own folder for the QUEUE test: two tracks that will not collide with
  // the ones queued by hand (sharing a name would make the QUEUE view show
  // them twice and the `hasText` assertions stop being unique).
  'upcoming/context_a.wav',
  'upcoming/context_b.wav',
  // Its own folder for the click-to-drop test: three tracks, so it does not
  // depend on whatever earlier tests left queued (those already mutated the
  // manual queue, and with fixtures playing in the background a track can end
  // on its own between tests and consume the queue).
  'dragtest/drag_a.wav',
  'dragtest/drag_b.wav',
  'dragtest/drag_c.wav'
]

/**
 * ALL TRACKS is one flat list sorted by folder, then A-Z inside each folder.
 * With the fixtures above that is a fixed, known order, and several tests below
 * depend on it:
 *
 *   0  idea_140bpm.wav   demos      <- alone in its folder
 *   1  drag_a.wav        dragtest
 *   2  drag_b.wav        dragtest
 *   3  drag_c.wav        dragtest
 *   4  loop_128bpm.wav   house
 *   5  beat_v3.wav       trap
 *   6  context_a.wav     upcoming
 *   7  context_b.wav     upcoming
 */
const TRACK_COUNT = FIXTURES.length

/** The fixtures are long enough to observe them playing. */
const FIXTURE_SECONDS = 5

let app: ElectronApplication
let page: Page
let mediaRoot: string
let userDataDir: string

test.beforeAll(async () => {
  mediaRoot = await createTempLibrary(FIXTURES, FIXTURE_SECONDS)
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

test('the root menu starts on ALL TRACKS', async () => {
  await expect(page.getByTestId('screen-title')).toHaveText('HOME')
  const rows = page.getByTestId('screen-row')
  await expect(rows.first()).toHaveText(/ALL TRACKS/i)
  await expect(rows.first()).toHaveAttribute('data-selected', 'true')
})

test('every file is reachable in one flat list, with its folder shown', async () => {
  const rows = page.getByTestId('screen-row')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('screen-title')).toHaveText('ALL TRACKS')

  // Every audio file, with no folder rows to drill through in between.
  await expect(rows).toHaveCount(TRACK_COUNT, { timeout: 10000 })
  const labels = await rows.allTextContents()
  expect(labels.every((label) => label.includes('.wav'))).toBe(true)

  // Each row carries the folder it came from.
  expect(labels[0]).toContain('idea_140bpm.wav')
  expect(labels[0]).toContain('demos')
})

test('clicking a track never blanks the list, even when it changes what plays', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await expect(rows).toHaveCount(TRACK_COUNT, { timeout: 10000 })

  // Reloading the list view (as QUEUE must, to track NOW) used to clear
  // `items` first and rebuild async, so the list flashed empty for a frame
  // every time playback moved to a different track -- including from a plain
  // click here on ALL TRACKS, a view that has nothing to do with QUEUE. A
  // MutationObserver catches that frame even if it never shows up in a
  // Playwright poll.
  await page.evaluate(() => {
    const list = document.querySelector('[data-testid="screen-list"]')
    ;(window as unknown as { __sawEmptyList: boolean }).__sawEmptyList = false
    if (!list?.parentElement) return
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-testid="screen-list"]')) {
        ;(window as unknown as { __sawEmptyList: boolean }).__sawEmptyList = true
      }
    })
    observer.observe(list.parentElement, { childList: true, subtree: true })
    ;(window as unknown as { __listObserver: MutationObserver }).__listObserver = observer
  })

  await rows.nth(0).click()
  await rows.nth(1).click()
  await rows.nth(2).click()
  await expect(page.getByTestId('screen-status')).toHaveText(PLAYING, { timeout: 10000 })

  const sawEmpty = await page.evaluate(
    () => (window as unknown as { __sawEmptyList: boolean }).__sawEmptyList
  )
  expect(sawEmpty).toBe(false)
})

/**
 * Makes sure NOW PLAYING is on screen.
 *
 * Starting a track only plays it: the list stays put so browsing is not
 * interrupted. The note in the header is the way to the visualizer. Selecting
 * the track that is already playing goes there on its own, though, so this may
 * find it already open -- and the note is hidden while it is.
 */
async function openNowPlaying(): Promise<void> {
  if (!(await page.getByTestId('now-playing').isVisible())) {
    await page.getByTestId('now-playing-button').click()
  }
  await expect(page.getByTestId('now-playing')).toBeVisible()
}

test('a track is reachable with two keypresses and no folder drilling', async () => {
  const rows = page.getByTestId('screen-row')
  await page.keyboard.press('Home')

  await expect(rows.first()).toHaveText(/ALL TRACKS/i)
  await page.keyboard.press('Enter')

  await expect(rows.first()).toHaveText(/\.wav/)
  await page.keyboard.press('Enter')

  // Playing does not move the screen: still on the list, ready to keep browsing.
  await expect(page.getByTestId('screen-title')).toHaveText('ALL TRACKS')
  await expect(page.getByTestId('now-playing')).not.toBeVisible()

  await openNowPlaying()
  await expect(page.getByTestId('np-title')).toHaveText(/\.wav$/)
})

test('skipping forward crosses folder boundaries instead of stopping', async () => {
  const rows = page.getByTestId('screen-row')

  // idea_140bpm is the only file in `demos`, so it is the last track of its
  // folder. Browsing by folder, NEXT had nowhere left to go and playback
  // stopped there. The whole library is the context now, so it must continue
  // into the next folder.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await rows.filter({ hasText: 'idea_140bpm' }).click()

  await openNowPlaying()
  await expect(page.getByTestId('np-title')).toHaveText('idea_140bpm.wav')

  // ArrowRight seeks within NOW PLAYING, so NEXT is triggered from the list
  // instead, where it still means "next track".
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowRight')

  await openNowPlaying()
  await expect(page.getByTestId('np-title')).toHaveText('drag_a.wav', { timeout: 10000 })
})

test('in NOW PLAYING, left/right seek instead of changing track, and up/down change track', async () => {
  const rows = page.getByTestId('screen-row')
  const positionMs = async (): Promise<number> =>
    Number(await page.getByTestId('now-playing').getAttribute('data-position'))

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await rows.filter({ hasText: 'idea_140bpm' }).click()

  await openNowPlaying()
  await expect(page.getByTestId('np-title')).toHaveText('idea_140bpm.wav')

  // Get partway into the track so a seek back is visible and never clamps to 0.
  await expect.poll(positionMs, { timeout: 10000 }).toBeGreaterThan(2000)
  const before = await positionMs()

  await page.keyboard.press('ArrowLeft')
  await expect.poll(positionMs).toBeLessThan(before)
  // Still the same track: a seek, not a skip.
  await expect(page.getByTestId('np-title')).toHaveText('idea_140bpm.wav')

  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('np-title')).toHaveText('drag_a.wav', { timeout: 10000 })

  await page.keyboard.press('ArrowUp')
  await expect(page.getByTestId('np-title')).toHaveText('idea_140bpm.wav', { timeout: 10000 })
})

/** Playback indicator drawn on the LCD. */
const PLAYING = '▶'

test('the analyser receives audio and the visualizer draws', async () => {
  await expect(page.getByTestId('screen-status')).toHaveText(PLAYING, { timeout: 15000 })

  // If the MediaElementSource were tainted, the analyser would return a flat
  // zero while the audio still played. This is what catches that.
  await expect
    .poll(async () => Number(await page.getByTestId('visualizer').getAttribute('data-peak')), {
      timeout: 15000,
      message: 'the AnalyserNode never received audio'
    })
    .toBeGreaterThan(0)
})

test('V cycles the visualizer modes', async () => {
  const canvas = page.getByTestId('visualizer')
  await expect(canvas).toHaveAttribute('data-mode', 'bars')

  await page.keyboard.press('v')
  await expect(canvas).toHaveAttribute('data-mode', 'scope')

  await page.keyboard.press('v')
  await expect(canvas).toHaveAttribute('data-mode', 'ambient')

  await page.keyboard.press('v')
  await expect(canvas).toHaveAttribute('data-mode', 'bars')
})

test('typing anywhere opens search and filters live', async () => {
  await page.keyboard.press('Home')
  await page.keyboard.type('bpm')

  await expect(page.getByTestId('screen-title')).toHaveText(/SEARCH: BPM/)
  await expect(page.getByTestId('screen-row')).toHaveCount(2, { timeout: 10000 })

  // Backspace deletes letters; on an empty search it leaves the search.
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('screen-title')).toHaveText(/SEARCH: BP/)

  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('screen-title')).toHaveText('HOME')
})

test('F marks a favorite and it shows up under FAVORITES', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await expect(rows.first()).toHaveText(/ALL TRACKS/i)
  await page.keyboard.press('Enter')
  await expect(rows.first()).toHaveText(/idea_140bpm/)

  await page.keyboard.press('f')
  await expect(rows.first()).toHaveText(/★/)

  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('screen-title')).toHaveText('FAVORITES')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toHaveText(/idea_140bpm/)
})

test('space pauses and resumes', async () => {
  await page.keyboard.press('Space')
  await expect(page.getByTestId('screen-status')).toHaveText('||', { timeout: 10000 })

  await page.keyboard.press('Space')
  await expect(page.getByTestId('screen-status')).toHaveText(PLAYING, { timeout: 10000 })
})

test('MOVE reorders the manual queue and LATER never offers it', async () => {
  const rows = page.getByTestId('screen-row')

  // Manual queue: two tracks via ADD TO QUEUE, in the order they are queued
  // (beat_v3 first, loop_128bpm second).
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await rows.filter({ hasText: 'beat_v3' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACTIONS')
  await rows.filter({ hasText: 'ADD TO QUEUE' }).click()

  await rows.filter({ hasText: 'loop_128bpm' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACTIONS')
  await rows.filter({ hasText: 'ADD TO QUEUE' }).click()

  // NOW + LATER: context_a is second to last in the flat list, so playing it
  // leaves exactly one track (context_b) in LATER.
  await rows.filter({ hasText: 'context_a' }).click()
  await expect(page.getByTestId('screen-status')).toHaveText(PLAYING, { timeout: 10000 })

  // QUEUE: NOW=context_a, MANUAL=[beat_v3, loop_128bpm], LATER=[context_b],
  // plus the SAVE AS PLAYLIST row at the end (5 in total).
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'QUEUE' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('QUEUE')
  await expect(rows).toHaveCount(5)

  const before = await rows.allTextContents()
  const beatBefore = before.findIndex((text) => text.includes('beat_v3'))
  const loopBefore = before.findIndex((text) => text.includes('loop_128bpm'))
  expect(beatBefore).toBeGreaterThanOrEqual(0)
  expect(loopBefore).toBeGreaterThan(beatBefore)

  // MOVE: grab the first of the manual queue (beat_v3) and push it down one
  // position with the keyboard, as if dragging it over loop_128bpm.
  await rows.filter({ hasText: 'beat_v3' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACTIONS')
  await rows.filter({ hasText: /^MOVE$/ }).click()

  await expect(page.getByTestId('moving-banner')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('moving-banner')).not.toBeVisible()
  await expect(rows).toHaveCount(5)

  const after = await rows.allTextContents()
  const beatAfter = after.findIndex((text) => text.includes('beat_v3'))
  const loopAfter = after.findIndex((text) => text.includes('loop_128bpm'))
  // Dropped one row lower: loop_128bpm became the head of the manual queue and
  // beat_v3 ended up right after it.
  expect(loopAfter).toBeLessThan(beatAfter)

  // LATER (context_b, all that is left of the context) never offers MOVE: it
  // does not even open the context menu, because that row carries no
  // `contextTarget` (unlike a manual queue row, which does, which is why
  // ACTIONS opened above).
  await rows.filter({ hasText: 'context_b' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('QUEUE')
  await expect(rows.filter({ hasText: /^MOVE$/ })).toHaveCount(0)
})

test('SAVE AS PLAYLIST turns the queue into a playable playlist', async () => {
  const rows = page.getByTestId('screen-row')

  // Picks up the queue built by the previous test: NOW + 2 manual + 1 LATER,
  // 4 tracks in total.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'QUEUE' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('QUEUE')

  await rows.filter({ hasText: 'SAVE AS PLAYLIST' }).click()
  await expect(page.getByTestId('prompt')).toBeVisible()
  await page.keyboard.type('Good session')
  await page.keyboard.press('Enter')

  // The prompt does not lead anywhere special (unlike the ADD TO PLAYLIST
  // picker): the QUEUE it came from is visible again.
  await expect(page.getByTestId('screen-title')).toHaveText('QUEUE')

  const playlists = await page.evaluate(() => window.waverr.library.listPlaylists())
  const saved = playlists.find((playlist) => playlist.name === 'Good session')
  expect(saved).toBeDefined()
  expect(saved?.trackCount).toBe(4)

  // It plays like any other playlist from PLAYLISTS.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'PLAYLISTS' }).click()
  await rows.filter({ hasText: 'GOOD SESSION' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('GOOD SESSION')
  await expect(rows).toHaveCount(4)

  await rows.first().click()
  await expect(page.getByTestId('screen-status')).toHaveText(PLAYING, { timeout: 10000 })
})

test('a duplicate name in SAVE AS PLAYLIST warns and creates nothing', async () => {
  const rows = page.getByTestId('screen-row')

  const before = await page.evaluate(() => window.waverr.library.listPlaylists())
  expect(before.filter((playlist) => playlist.name === 'Good session')).toHaveLength(1)

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'QUEUE' }).click()
  await rows.filter({ hasText: 'SAVE AS PLAYLIST' }).click()
  await expect(page.getByTestId('prompt')).toBeVisible()
  await page.keyboard.type('Good session')
  await page.keyboard.press('Enter')

  // The prompt stays open showing the warning instead of returning to QUEUE.
  await expect(page.getByTestId('prompt')).toBeVisible()
  await expect(page.getByTestId('prompt')).toContainText('ALREADY EXISTS')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('screen-title')).toHaveText('QUEUE')

  const after = await page.evaluate(() => window.waverr.library.listPlaylists())
  expect(after.filter((playlist) => playlist.name === 'Good session')).toHaveLength(1)
})

test('dropping with a click in move mode reorders the queue without mangling it', async () => {
  const rows = page.getByTestId('screen-row')

  // Assumes nothing about what earlier tests left in the queue: with fixtures
  // playing in the background a track can end on its own between tests and
  // consume whatever is queued. So this test uses three tracks of its own
  // (DRAGTEST) and compares their relative positions, never absolute row
  // indices or a total row count.
  //
  // Pause before touching anything: if it kept playing, the current track
  // could end midway through and consume the manual queue on its own, dirtying
  // a comparison that is about something else (the click, not auto-advance).
  await page.keyboard.press('Home')
  const status = await page.getByTestId('screen-status').textContent()
  if (status?.includes(PLAYING)) {
    await page.keyboard.press('Space')
    await expect(page.getByTestId('screen-status')).toHaveText('||')
  }

  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await rows.filter({ hasText: 'drag_a' }).click({ button: 'right' })
  await rows.filter({ hasText: 'ADD TO QUEUE' }).click()
  await rows.filter({ hasText: 'drag_b' }).click({ button: 'right' })
  await rows.filter({ hasText: 'ADD TO QUEUE' }).click()
  await rows.filter({ hasText: 'drag_c' }).click({ button: 'right' })
  await rows.filter({ hasText: 'ADD TO QUEUE' }).click()

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'QUEUE' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('QUEUE')

  // Queued in order a, b, c: they stay that way, consecutive, no matter how
  // many other rows come first (the NOW row is always first if something is
  // playing).
  const before = await rows.allTextContents()
  const nowBefore = before[0]
  const indexA0 = before.findIndex((text) => text.includes('drag_a'))
  const indexB0 = before.findIndex((text) => text.includes('drag_b'))
  const indexC0 = before.findIndex((text) => text.includes('drag_c'))
  expect(indexA0).toBeGreaterThanOrEqual(0)
  expect(indexB0).toBe(indexA0 + 1)
  expect(indexC0).toBe(indexB0 + 1)

  // Grab the first of the three (drag_a) with MOVE.
  await rows.filter({ hasText: 'drag_a' }).click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACTIONS')
  await rows.filter({ hasText: /^MOVE$/ }).click()
  await expect(page.getByTestId('moving-banner')).toBeVisible()

  // Drop with a CLICK (not OK, not the arrows) on the drag_c row. Before this
  // was fixed, a click during a drag ran the row's normal activation (jump to
  // that track) instead of dropping there: the screen would have gone to NOW
  // PLAYING with drag_c playing, and `removeFromQueue(0)` would have run in a
  // loop, mangling everything queued before it.
  await rows.filter({ hasText: 'drag_c' }).click()
  await expect(page.getByTestId('moving-banner')).not.toBeVisible()

  // Still on QUEUE (it did not go to NOW PLAYING) and NOW did not change: the
  // click was read as "drop here", not as "play this track now".
  await expect(page.getByTestId('screen-title')).toHaveText('QUEUE')
  await expect(page.getByTestId('now-playing')).not.toBeVisible()
  const after = await rows.allTextContents()
  expect(after[0]).toBe(nowBefore)

  // All three are still there, none lost or duplicated, in the order that
  // moving drag_a to the end of the manual queue produces: b, c, a.
  const indexA1 = after.findIndex((text) => text.includes('drag_a'))
  const indexB1 = after.findIndex((text) => text.includes('drag_b'))
  const indexC1 = after.findIndex((text) => text.includes('drag_c'))
  expect(after.filter((text) => text.includes('drag_a'))).toHaveLength(1)
  expect(after.filter((text) => text.includes('drag_b'))).toHaveLength(1)
  expect(after.filter((text) => text.includes('drag_c'))).toHaveLength(1)
  expect(indexB1).toBeGreaterThanOrEqual(0)
  expect(indexC1).toBe(indexB1 + 1)
  expect(indexA1).toBe(indexC1 + 1)
})

test('holding Backspace clears the query without leaving the search', async () => {
  await page.keyboard.press('Home')
  await page.keyboard.type('bpm')
  await expect(page.getByTestId('screen-title')).toHaveText(/SEARCH: BPM/)

  // Holding the key to wipe what was typed must stop at the empty query rather
  // than running straight through it and dropping the user back in the menu.
  // `keyboard.down` fires a single keydown and never autorepeats, so the
  // repeat ticks the OS would send are dispatched by hand: that stream, not a
  // held physical key, is what the guard actually sees.
  await page.keyboard.down('Backspace')
  for (let tick = 0; tick < 8; tick += 1) {
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', repeat: true, bubbles: true })
      )
    )
  }
  await expect(page.getByTestId('screen-title')).toHaveText('SEARCH: _')
  await page.keyboard.up('Backspace')

  // A deliberate press after the hold still leaves.
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('screen-title')).toHaveText('HOME')
})

test('holding Enter opens the context menu instead of playing the track', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await expect(rows.first()).toHaveText(/\.wav/)

  // A tap plays; a hold opens the actions for the row and must not play it.
  await page.keyboard.down('Enter')
  await expect(page.getByTestId('screen-title')).toHaveText('ACTIONS', { timeout: 10000 })
  await page.keyboard.up('Enter')
  await expect(page.getByTestId('now-playing')).not.toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('screen-title')).toHaveText('ALL TRACKS')
})

test('the magnifying glass opens search, and +/- moves the volume', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await page.getByTestId('search-button').click()
  await expect(page.getByTestId('screen-title')).toHaveText('SEARCH: _')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('screen-title')).toHaveText('HOME')

  // The engine's <audio> is never attached to the document, so the level is
  // read where the slider reads it: off the rendered fill on NOW PLAYING.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await rows.first().click()
  await openNowPlaying()

  const track = page.getByTestId('volume')
  const volume = async (): Promise<number> =>
    Number(await track.getAttribute('data-volume'))

  const start = await volume()
  await page.keyboard.press('-')
  await expect.poll(volume).toBeCloseTo(start - 0.05, 2)
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await expect.poll(volume).toBeCloseTo(start + 0.05, 2)

  // Dragging the track sets the level from where the pointer lands.
  const box = (await track.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2)
  await page.mouse.up()
  await expect.poll(volume).toBeCloseTo(0.75, 1)

  // The volume keys must not have leaked into a search box on the way: they
  // adjust the level and are never typed.
  await expect(page.getByTestId('screen-title')).toHaveText('NOW PLAYING')
})

test('the progress bar can be clicked or dragged to seek', async () => {
  const rows = page.getByTestId('screen-row')
  const positionMs = async (): Promise<number> =>
    Number(await page.getByTestId('now-playing').getAttribute('data-position'))

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await rows.filter({ hasText: 'idea_140bpm' }).click()
  await openNowPlaying()

  const bar = page.getByTestId('progress')
  const box = (await bar.boundingBox())!

  await bar.click({ position: { x: box.width * 0.8, y: box.height / 2 } })
  await expect.poll(positionMs).toBeGreaterThan(3000)

  // Dragging sets position from wherever the pointer lands, same as volume.
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2)
  await page.mouse.up()
  await expect.poll(positionMs).toBeGreaterThan(1500)
  await expect.poll(positionMs).toBeLessThan(2600)
})

test('the header note returns to the track without restarting it', async () => {
  const rows = page.getByTestId('screen-row')
  // Only readable while NOW PLAYING is on screen, which is the only place the
  // position is needed below.
  const positionMs = async (): Promise<number> =>
    Number(await page.getByTestId('now-playing').getAttribute('data-position'))

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await rows.filter({ hasText: 'drag_b' }).click()

  // Playing leaves the list exactly where it was.
  await expect(page.getByTestId('screen-title')).toHaveText('ALL TRACKS')

  await openNowPlaying()
  await expect(page.getByTestId('np-title')).toHaveText('drag_b.wav')

  // Let it get somewhere into the track before leaving, so a restart would be
  // unmistakable.
  await expect.poll(positionMs, { timeout: 10000 }).toBeGreaterThan(400)
  const before = await positionMs()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('screen-title')).toHaveText('ALL TRACKS')

  // The note in the header is the way back, and it picks up where it was.
  await openNowPlaying()
  await expect(page.getByTestId('np-title')).toHaveText('drag_b.wav')
  expect(await positionMs()).toBeGreaterThanOrEqual(before)

  // Selecting the row that is already playing is the one case that does move
  // the screen: there is nothing to start, so it can only mean "take me to it".
  // And it must arrive where the track already was, not back at the beginning.
  const beforeRow = await positionMs()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('screen-title')).toHaveText('ALL TRACKS')
  await rows.filter({ hasText: 'drag_b' }).click()
  await expect(page.getByTestId('now-playing')).toBeVisible()
  await expect(page.getByTestId('np-title')).toHaveText('drag_b.wav')
  expect(await positionMs()).toBeGreaterThanOrEqual(beforeRow)
})

test('the trash icon hides a track, and UNDO brings it back', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  // The trash sits beside the row button, not inside it, so it is reached
  // through the wrapper that holds both.
  const victim = page.getByTestId('screen-row-wrap').filter({ hasText: 'loop_128bpm' })
  await expect(victim).toHaveCount(1)

  // The icon only appears on hover, and must not activate the row it sits on.
  await victim.hover()
  await victim.getByTestId('row-trash').click()

  await expect(rows.filter({ hasText: 'loop_128bpm' })).toHaveCount(0)
  await expect(page.getByTestId('now-playing')).not.toBeVisible()

  await page.getByTestId('undo-hide').click()
  await expect(rows.filter({ hasText: 'loop_128bpm' })).toHaveCount(1)
})

test('a hidden track is restorable from SETTINGS long after the undo is gone', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  const victim = page.getByTestId('screen-row-wrap').filter({ hasText: 'beat_v3' })
  await victim.hover()
  await victim.getByTestId('row-trash').click()
  await expect(rows.filter({ hasText: 'beat_v3' })).toHaveCount(0)

  // Outlast the undo offer: from here the settings screen is the only way back.
  await expect(page.getByTestId('undo-hide')).toHaveCount(0, { timeout: 10000 })

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'SETTINGS' }).click()
  await rows.filter({ hasText: 'HIDDEN TRACKS' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('HIDDEN TRACKS')

  await rows.filter({ hasText: 'beat_v3' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('HIDDEN TRACKS')

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'ALL TRACKS' }).click()
  await expect(rows.filter({ hasText: 'beat_v3' })).toHaveCount(1)
})
