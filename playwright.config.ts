import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  // Una sola instancia a la vez: la app toma un single-instance lock.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']]
})
