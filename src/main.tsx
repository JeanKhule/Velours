import { createRoot } from 'react-dom/client'
import '@fontsource/bodoni-moda/400-italic.css'
import '@fontsource/bodoni-moda/500-italic.css'
import '@fontsource/jost/400.css'
import '@fontsource/jost/500.css'
import '@fontsource/jost/600.css'
import '@fontsource/pinyon-script/400.css'
import './theme.css'
import App from './App'

// Warm touch: the blush glow starts exactly where the finger lands.
addEventListener('pointerdown', (e) => {
  const el = (e.target as Element).closest?.('button')
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--x', `${e.clientX - r.left}px`)
  el.style.setProperty('--y', `${e.clientY - r.top}px`)
})

createRoot(document.getElementById('root')!).render(<App />)

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js')
