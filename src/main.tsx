import { createRoot } from 'react-dom/client'
import '@fontsource/bodoni-moda/400-italic.css'
import '@fontsource/jost/400.css'
import '@fontsource/jost/500.css'
import '@fontsource/pinyon-script/400.css'
import './styles.css'
import './da.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js')
