import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource/sora/400.css'
import '@fontsource/sora/500.css'
import '@fontsource/sora/600.css'
import '@fontsource/sora/700.css'
import './styles/tokens.css'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('No existe #root en index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
