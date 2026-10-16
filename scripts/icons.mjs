// Renders public/icon.svg to the PNG icons Android and iOS need (run: node scripts/icons.mjs).
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const svg = readFileSync('public/icon.svg', 'utf8')
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
for (const [file, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.12], ['apple-touch-icon.png', 180, 0]]) {
  await page.setViewportSize({ width: size, height: size })
  // Maskable: full-bleed background, logo kept inside the safe zone.
  await page.setContent(`<body style="margin:0;background:#0A0607;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size * (1 - 2 * pad)}px;height:${size * (1 - 2 * pad)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`)
  await page.screenshot({ path: `public/${file}`, omitBackground: false })
}
await browser.close()
console.log('icons ok')
