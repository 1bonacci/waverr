import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, test } from '@playwright/test'

const MEDIA_DIR = process.env['WAVERR_MEDIA_DIR'] ?? ''

test.skip(!MEDIA_DIR, 'define WAVERR_MEDIA_DIR con audio real')

test('reproduce cada formato de la carpeta indicada', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'waverr-fmt-'))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) env[key] = value
  }

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
  const page = await app.firstWindow()

  await page.waitForSelector('[data-testid="screen-title"]')
  await page.evaluate((root: string) => window.waverr.library.addRoot(root), MEDIA_DIR)
  await page.waitForSelector('[data-testid="screen-row"]', { timeout: 30000 })
  // Gesto de usuario real: sin el, Chromium no deja arrancar el AudioContext.
  await page.getByTestId('screen-row').first().click()

  const report = await page.evaluate(async () => {
    const tracks = await window.waverr.library.search({ limit: 50 })
    const context = new AudioContext()
    const results: Array<Record<string, unknown>> = []

    for (const track of tracks) {
      const audio = new Audio()
      audio.crossOrigin = 'anonymous'
      const source = context.createMediaElementSource(audio)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyser.connect(context.destination)
      audio.src = `waverr://track/${track.id}`

      const outcome = await new Promise<string>((resolve) => {
        audio.addEventListener('canplay', () => resolve('canplay'))
        audio.addEventListener('error', () => resolve(`error:${audio.error?.code}`))
        setTimeout(() => resolve('timeout'), 8000)
      })

      let peak = 0
      if (outcome === 'canplay') {
        await audio.play().catch(() => {})
        const data = new Uint8Array(analyser.frequencyBinCount)
        for (let i = 0; i < 15; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          analyser.getByteFrequencyData(data)
          for (const value of data) if (value > peak) peak = value
        }
        audio.pause()
      }

      results.push({
        file: track.filename,
        ext: track.ext,
        durationMs: track.durationMs,
        outcome,
        analyserPeak: peak
      })
    }

    return results
  })

  console.log('FORMATOS:', JSON.stringify(report, null, 2))

  await app.close()
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
})
