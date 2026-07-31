/// <reference types="vite/client" />

import type { WaverrApi } from '@shared/types'

declare global {
  interface Window {
    waverr: WaverrApi
  }
}

export {}
