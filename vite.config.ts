import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Strict CSP on the built app only (dev needs Vite's inline HMR script).
const csp = {
  name: 'csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'" />`
    ),
}

// Relative base: works on GitHub Pages under any repo path.
export default defineConfig({ base: './', plugins: [react(), csp], server: { host: true } })
