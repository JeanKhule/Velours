// Full end-to-end test: two browsers act as two phones, over 5 simulated days.
// Run: npm run test:e2e   (builds, serves dist/ with the production CSP, drives Microsoft Edge)
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import qrcode from 'qrcode-generator'

const PORT = 47613
const BASE = `http://localhost:${PORT}/`
const DAY = (d) => new Date(`2026-10-${d}T20:00:00`)

const results = []
const errors = []
const foreign = []
let failed = false

async function check(name, fn) {
  if (failed) return results.push(['SKIP', name])
  try {
    await fn()
    results.push(['OK  ', name])
  } catch (e) {
    failed = true
    results.push(['FAIL', name, e.message.split('\n')[0]])
  }
}

// ---------- helpers ----------

async function phone(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] })
  await ctx.clock.setFixedTime(DAY(16))
  await ctx.addInitScript(() => {
    // Behave like the app installed on the home screen.
    const mm = window.matchMedia.bind(window)
    window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q))
    if (navigator.clipboard) {
      navigator.clipboard.writeText = async (t) => void (window.__l = t)
      navigator.clipboard.readText = async () => window.__clip ?? ''
    }
  })
  ctx.on('request', (r) => !r.url().startsWith(BASE) && !r.url().startsWith('data:') && foreign.push(r.url()))
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.setDefaultTimeout(8000)
  await p.goto(BASE)
  return p
}

const btn = (p, name) => p.getByRole('button', { name, exact: typeof name === 'string' })
const panel = (p) => p.locator('.panel').textContent() // raw text: some labels are uppercased by CSS
async function tab(p, name) {
  await p.locator('nav.tabs').getByRole('button', { name, exact: true }).click()
  await p.locator('.panel h1', { hasText: name }).waitFor()
  await p.waitForTimeout(150)
}

async function create(p, pseudo, pin) {
  await p.getByLabel('Pseudo').fill(pseudo)
  await p.getByLabel('Code PIN (6 à 8 chiffres)').fill(pin)
  await p.getByLabel('Confirme le code').fill(pin)
  await btn(p, 'Créer mon profil').click()
}

async function open(p, pin, role) {
  await p.goto(BASE)
  await p.getByLabel('Code PIN').fill(pin)
  await btn(p, 'Ouvrir').click()
  // The role screen only shows up once per day.
  await p.locator('.roles, .home').first().waitFor()
  if (await p.locator('.roles').count()) await btn(p, new RegExp(`^${role}`)).click()
  await p.locator('.home').waitFor()
}

// The sealed-link sheet: copy the link and close it.
async function grab(p) {
  await btn(p, 'Copier le lien').click()
  const link = await p.evaluate(() => window.__l)
  await btn(p, 'Fermer').click()
  return link
}
const send = async (p) => (await p.locator('.sync button', { hasText: 'Envoyer' }).click(), grab(p))

// Delivers a link like a messenger tap on an open app (hash change).
async function deliver(p, link) {
  await p.evaluate((h) => (location.hash = h), new URL(link).hash.slice(1))
  const n = p.locator('.notice')
  await n.waitFor()
  const text = await n.innerText()
  await n.click()
  return text
}

async function newDay(ctxs, d) {
  for (const c of ctxs) await c.clock.setFixedTime(DAY(d))
}

async function setSlider(p, i, v) {
  await p.locator('input[type=range]').nth(i).fill(String(v))
}

// A one-frame Y4M video showing a QR code, fed to the fake camera.
function qrVideo(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const W = 640, H = 480, n = qr.getModuleCount(), cell = Math.floor(440 / (n + 8)), off = Math.floor((W - (n + 8) * cell) / 2)
  const y = Buffer.alloc(W * H, 255)
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c))
        for (let dy = 0; dy < cell; dy++)
          y.fill(0, (20 + (r + 4) * cell + dy) * W + off + (c + 4) * cell, (20 + (r + 4) * cell + dy) * W + off + (c + 5) * cell)
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128)
  const file = join(mkdtempSync(join(tmpdir(), 'bm-')), 'qr.y4m')
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\nFRAME\n`), y, uv]))
  return file
}

// ---------- run ----------

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' })
// Wait until our own app answers (and not something else on that port).
for (let i = 0; ; i++) {
  const html = await fetch(BASE).then((r) => r.text()).catch(() => '')
  if (html.includes('<title>BM</title>')) break
  if (i > 40) throw new Error(`BM n'a pas démarré sur ${BASE}`)
  await new Promise((r) => setTimeout(r, 250))
}

const browserB = await chromium.launch({ channel: 'msedge' })
const B = await phone(browserB) // Velours
let A, browserA // Maitre
let codeA, codeB, safety
const PIN_A = '123456', PIN_B = '654321'

try {
  await check('Profil : refuse un pseudo vide, un PIN trop court, deux PIN différents', async () => {
    await btn(B, 'Créer mon profil').click()
    assert.match(await B.getByRole('alert').innerText(), /pseudo/)
    await B.getByLabel('Pseudo').fill('Velours')
    await B.getByLabel('Code PIN (6 à 8 chiffres)').fill('123')
    await btn(B, 'Créer mon profil').click()
    assert.match(await B.getByRole('alert').innerText(), /6 à 8 chiffres/)
    await B.getByLabel('Code PIN (6 à 8 chiffres)').fill(PIN_B)
    await B.getByLabel('Confirme le code').fill('111111')
    await btn(B, 'Créer mon profil').click()
    assert.match(await B.getByRole('alert').innerText(), /correspondent pas/)
  })

  await check('Profil : création (pseudo + PIN, sans e-mail)', async () => {
    await create(B, 'Velours', PIN_B)
    await B.getByText("Qui es‑tu aujourd'hui ?").waitFor()
  })

  await check('Stockage : chiffré, aucun pseudo en clair dans IndexedDB', async () => {
    const r = await B.evaluate(
      () =>
        new Promise((ok) => {
          const q = indexedDB.open('bm')
          q.onsuccess = () => {
            const g = q.result.transaction('kv').objectStore('kv').get('vault')
            g.onsuccess = () => ok({ keys: Object.keys(g.result), clear: new TextDecoder().decode(g.result.data).includes('Velours') })
          }
        })
    )
    assert.deepStrictEqual(r, { keys: ['salt', 'iv', 'data'], clear: false })
  })

  await check('Déverrouillage : mauvais PIN refusé, bon PIN accepté', async () => {
    await B.goto(BASE)
    await B.getByLabel('Code PIN').fill('999999')
    await btn(B, 'Ouvrir').click()
    assert.match(await B.getByRole('alert').innerText(), /incorrect/)
    await open(B, PIN_B, 'Sub')
    await B.locator('.panel').waitFor()
  })

  await check('Rôle choisi une seule fois par jour (pas redemandé à la réouverture)', async () => {
    await B.goto(BASE)
    await B.getByLabel('Code PIN').fill(PIN_B)
    await btn(B, 'Ouvrir').click()
    await B.locator('.home').waitFor()
    assert.strictEqual(await B.locator('.roles').count(), 0)
    assert.strictEqual(await B.locator('.top .pill').innerText(), 'Sub')
  })

  const hide = (p) =>
    p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
  const show = (p) =>
    p.evaluate(() => {
      delete document.visibilityState
      document.dispatchEvent(new Event('visibilitychange'))
    })

  await check('Verrouillage : un aller-retour rapide vers une autre app ne redemande pas le PIN', async () => {
    await hide(B)
    await B.context().clock.setFixedTime(new Date('2026-10-16T20:01:00'))
    await show(B)
    await B.locator('.home').waitFor()
    assert.strictEqual(await B.getByText('Entre ton code').count(), 0)
  })

  await check('Verrouillage : PIN redemandé après plus de 5 minutes en arrière-plan', async () => {
    await hide(B)
    await B.context().clock.setFixedTime(new Date('2026-10-16T20:08:00'))
    await show(B)
    await B.getByText('Entre ton code').waitFor()
    await B.context().clock.setFixedTime(DAY(16))
    await open(B, PIN_B, 'Sub')
  })

  await check('Avant appairage : sections verrouillées', async () => {
    for (const t of ['Question du jour', 'Tâche du jour', 'Contrat', 'Historique']) {
      await tab(B, t)
      assert.match(await panel(B), /Liez vos deux téléphones/)
    }
  })

  await check('Appairage : QR affiché', async () => {
    await btn(B, 'Appairer').click()
    await B.locator('.qr svg').waitFor()
    codeB = await B.locator('textarea[readonly]').inputValue()
    assert.match(codeB, /^BM1\./)
  })

  // Phone A gets a fake camera that films B's QR.
  browserA = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${qrVideo(codeB ?? "none")}`],
  })
  A = await phone(browserA)
  const ctxs = [A.context(), B.context()]

  await check('Appairage : scan du QR de l’autre à la caméra', async () => {
    await create(A, 'Maitre', PIN_A)
    await A.locator('.roles').waitFor()
    assert.match(await A.locator('.roles').textContent(), /tiens la laisse[\s\S]*je veux les deux[\s\S]*j'obéis sans discuter/)
    await btn(A, /^Dom/).click()
    await btn(A, 'Appairer').click()
    codeA = await A.locator('textarea[readonly]').inputValue()
    await btn(A, 'Scanner son QR').click()
    await A.locator('.safety').waitFor({ timeout: 15000 })
    safety = await A.locator('.safety').innerText()
    await A.locator('.qr svg').waitFor() // A's own QR stays visible so B can still scan it
  })

  await check('Appairage : code recopié (sans caméra) et même code de sécurité des deux côtés', async () => {
    await B.getByText('Pas de caméra ?').click()
    await B.getByPlaceholder('Colle son code ici').fill(codeA)
    await btn(B, 'Valider son code').click()
    assert.strictEqual(await B.locator('.safety').innerText(), safety)
    await btn(A, /^C'est le même/).click()
    await btn(B, /^C'est le même/).click()
    await A.locator('.sync').waitFor()
    await B.locator('.sync').waitFor()
  })

  await check('Rôle du partenaire visible après un échange', async () => {
    assert.match(await deliver(B, await send(A)), /reçu|Rien de nouveau/)
    assert.match(await B.locator('.sync').innerText(), /Maitre · Dom/)
    await deliver(A, await send(B))
    assert.match(await A.locator('.sync').innerText(), /Velours · Sub/)
  })

  await check('Question du jour : la même chez les deux', async () => {
    await tab(A, 'Question du jour')
    await tab(B, 'Question du jour')
    const qa = await A.locator('.question .q').innerText()
    assert.strictEqual(await B.locator('.question .q').innerText(), qa)
  })

  await check('Question du jour : réponse de l’autre cachée tant qu’on n’a pas répondu, puis dévoilée', async () => {
    await A.getByPlaceholder('Ta réponse (courte)').fill('Te voir attendre à genoux.')
    await btn(A, 'Répondre').click()
    await deliver(B, await send(A))
    const before = await panel(B)
    assert.match(before, /Maitre a répondu\. Réponds pour découvrir/)
    assert.doesNotMatch(before, /genoux/)
    await B.getByPlaceholder('Ta réponse (courte)').fill('Que tu me fasses attendre.')
    await btn(B, 'Répondre').click()
    assert.match(await panel(B), /Te voir attendre à genoux\./)
  })

  await check('Question du jour : messagerie du jour', async () => {
    await B.getByPlaceholder('Écris…').fill('Ce soir ?')
    await btn(B, 'Ajouter').click()
    await deliver(A, await send(B))
    assert.match(await panel(A), /Que tu me fasses attendre\.[\s\S]*Ce soir \?/)
  })

  await check('Tâche : demande de mood (Dom)', async () => {
    await tab(A, 'Tâche du jour')
    await btn(A, 'Demander ton mood').click()
    await deliver(B, await grab(A))
    await tab(B, 'Tâche du jour')
    assert.match(await panel(B), /Maitre demande ton mood/)
  })

  await check('Tâche : une seule demande de mood par jour', async () => {
    assert.strictEqual(await btn(A, 'Demander ton mood').count(), 0)
  })

  await check('Tâche : curseurs Envie / Temps avec les libellés crus', async () => {
    await setSlider(B, 0, 3)
    await setSlider(B, 1, 2)
    const t = await panel(B)
    assert.match(t, /trempé·e \/ raide/)
    assert.match(t, /petite pause salace/)
    await btn(B, 'Valider').click()
    await deliver(A, await grab(B))
    assert.match(await panel(A), /Tâche à exécuter/)
  })

  await check('Tâche : rédaction et envoi', async () => {
    await A.getByPlaceholder('Écris la tâche, adaptée à ce mood').fill('Porte le collier rouge ce soir.')
    await btn(A, 'Envoyer la tâche').click()
    await deliver(B, await grab(A))
    assert.match(await panel(B), /Porte le collier rouge ce soir\./)
  })

  await check('Tâche : « Fait » puis feedback obligatoire (commentaire requis)', async () => {
    await btn(B, 'Fait').click()
    assert.ok(await btn(B, 'Valider et envoyer').isDisabled())
    await setSlider(B, 0, 4)
    await setSlider(B, 1, 3)
    await setSlider(B, 2, 4)
    await B.getByPlaceholder('Commentaire (obligatoire)').fill("Troublant, j'ai adoré.")
    await btn(B, 'Valider et envoyer').click()
    const link = await grab(B)
    assert.match(await panel(B), /Ton ressenti est parti chez Maitre/)
    assert.doesNotMatch(await panel(B), /Plu 4/)
    await deliver(A, link)
    assert.match(await panel(A), /Plu 4\/4 · Pendant 3\/4 · Après 4\/4/)
  })

  await check('Historique du donneur : tableau complet + tri « Les mieux notées »', async () => {
    await tab(A, 'Historique')
    const row = await A.locator('tbody tr').first().innerText()
    assert.match(row, /16\/10\/2026\s+3 \/ 2\s+Porte le collier rouge ce soir\.\s+4\s+3\s+4\s+Troublant/)
    await btn(A, 'Les mieux notées').click()
    await btn(A, 'Par date').waitFor()
  })

  await check('Contrat : phrase selon les rôles du jour + signatures datées', async () => {
    await tab(A, 'Contrat')
    await tab(B, 'Contrat')
    assert.match(await A.locator('.conclusion').innerText(), /Moi, Maitre, prends possession de Velours\./)
    assert.match(await B.locator('.conclusion').innerText(), /Moi, Velours, appartiens à Maitre\./)
    for (const p of [A, B]) {
      await p.locator('svg.pad').scrollIntoViewIfNeeded()
      const box = await p.locator('svg.pad').boundingBox()
      await p.mouse.move(box.x + 20, box.y + 60)
      await p.mouse.down()
      for (let i = 1; i <= 15; i++) await p.mouse.move(box.x + 20 + i * 15, box.y + 60 - Math.sin(i / 2) * 30)
      await p.mouse.up()
      await btn(p, 'Signer pour toujours').click()
    }
    const la = await grab(A), lb = await grab(B)
    await deliver(B, la)
    await deliver(A, lb)
    for (const p of [A, B]) {
      assert.strictEqual(await p.locator('.sigs svg').count(), 2)
      assert.match(await p.locator('.sigs').innerText(), /16\/10\/2026[\s\S]*16\/10\/2026/)
      assert.strictEqual(await p.locator('svg.pad').count(), 0, 'cannot sign twice')
    }
  })

  // ----- Day 2 -----
  await check('Nouveau jour (17/10) : réouverture, PIN + rôles Dom / Sub', async () => {
    await newDay(ctxs, 17)
    await open(A, PIN_A, 'Dom')
    await open(B, PIN_B, 'Sub')
  })

  await check('Jour 2 : nouvelle question, « J’ai ma question »', async () => {
    await A.getByRole('button', { name: "J'ai ma question" }).click()
    await A.getByPlaceholder("Ta question pour aujourd'hui").fill('Quel est ton plus beau souvenir avec moi ?')
    await btn(A, 'Poser cette question').click()
    await deliver(B, await send(A))
    assert.match(await B.locator('.question').textContent(), /Votre question[\s\S]*plus beau souvenir/)
  })

  await check('Jour 2 : la question d’hier est dans l’historique', async () => {
    await tab(B, 'Historique')
    assert.match(await panel(B), /vendredi 16 octobre/)
  })

  await check('Jour 2 : tâche donnée mais non réalisée', async () => {
    await tab(A, 'Tâche du jour')
    await tab(B, 'Tâche du jour')
    await btn(A, 'Demander ton mood').click()
    await deliver(B, await grab(A))
    await btn(B, 'Valider').click()
    await deliver(A, await grab(B))
    await A.getByPlaceholder('Écris la tâche, adaptée à ce mood').fill('Écris-moi un poème.')
    await btn(A, 'Envoyer la tâche').click()
    await deliver(B, await grab(A))
    assert.match(await panel(B), /avant minuit/)
  })

  // ----- Day 3 -----
  await check('Nouveau jour (18/10) : réouverture, PIN + rôles Dom / Sub', async () => {
    await newDay(ctxs, 18)
    await open(A, PIN_A, 'Dom')
    await open(B, PIN_B, 'Sub')
  })

  await check('Jour 3 : tâche manquée → « non réalisée » + 1 token, compteur visible chez le puni', async () => {
    assert.match(await B.locator('.token').innerText(), /^1 token/)
    await tab(A, 'Historique')
    assert.match(await panel(A), /Non réalisée/)
    assert.match(await panel(A), /Velours doit 1 token/)
  })

  await check('Jour 3 : seul le donneur décompte un token', async () => {
    await tab(B, 'Historique')
    assert.strictEqual(await btn(B, 'Décompter un token').count(), 0)
    await btn(A, 'Décompter un token').click()
    await deliver(B, await grab(A))
    assert.match(await B.locator('.token').innerText(), /^0 token/)
  })

  await check('Jour 3 : safeword → fin du jeu pour la journée, question toujours dispo', async () => {
    await tab(A, 'Tâche du jour')
    await tab(B, 'Tâche du jour')
    await btn(A, 'Demander ton mood').click()
    await deliver(B, await grab(A))
    assert.strictEqual(await btn(B, 'Safeword').count(), 0, 'no safeword before a task is received')
    await btn(B, 'Valider').click()
    await deliver(A, await grab(B))
    await A.getByPlaceholder('Écris la tâche, adaptée à ce mood').fill('Mets-toi à genoux.')
    await btn(A, 'Envoyer la tâche').click()
    await deliver(B, await grab(A))
    await btn(B, 'Safeword').click()
    await btn(B, /^Prononcer le safeword/).click()
    await deliver(A, await grab(B))
    for (const p of [A, B]) {
      assert.match(await panel(p), /Le jeu s'arrête pour aujourd'hui/)
      assert.strictEqual(await btn(p, 'Demander ton mood').count(), 0)
    }
    await tab(B, 'Question du jour')
    await B.getByPlaceholder('Ta réponse (courte)').waitFor()
  })

  // ----- Day 4 -----
  await check('Nouveau jour (19/10) : réouverture, PIN + rôles Switch / Switch', async () => {
    await newDay(ctxs, 19)
    await open(A, PIN_A, 'Switch')
    await open(B, PIN_B, 'Switch')
  })

  await check('Jour 4 : le safeword n’a créé aucun token', async () => {
    assert.match(await B.locator('.token').innerText(), /^0 token/)
    await tab(A, 'Historique')
    assert.match(await panel(A), /Safeword/)
  })

  await check('Jour 4 : deux Switch → chacun peut lancer sa demande', async () => {
    await tab(A, 'Tâche du jour')
    await tab(B, 'Tâche du jour')
    await btn(A, 'Demander ton mood').click()
    await deliver(B, await grab(A))
    assert.match(await panel(B), /Maitre demande ton mood/)
    await btn(B, 'Demander ton mood').waitFor()
  })

  await check('Jour 4 : contrat « Switch face à Switch »', async () => {
    await tab(B, 'Contrat')
    assert.match(await B.locator('.conclusion').innerText(), /déclare vouloir me pervertir avec Maitre/)
  })

  // ----- Day 5 -----
  await check('Nouveau jour (20/10) : réouverture, PIN + rôles Dom / Dom', async () => {
    await newDay(ctxs, 20)
    await open(A, PIN_A, 'Dom')
    await open(B, PIN_B, 'Dom')
  })

  await check('Jour 5 : deux Dom → mood partagé sans tâche', async () => {
    await tab(A, 'Tâche du jour')
    await tab(B, 'Tâche du jour')
    await btn(A, 'Demander ton mood').click()
    await deliver(B, await grab(A))
    await btn(B, 'Valider').click()
    await deliver(A, await grab(B))
    assert.match(await panel(A), /sans tâche/)
    assert.strictEqual(await A.getByPlaceholder('Écris la tâche, adaptée à ce mood').count(), 0)
  })

  await check('Jour 5 : contrat « deux Dom »', async () => {
    await tab(A, 'Contrat')
    assert.match(await A.locator('.conclusion').innerText(), /défie Velours de me faire plier/)
  })

  await check('Test secret : 7 touches sur le logo réinitialisent la journée des deux côtés', async () => {
    await A.locator('.top .logo').click({ clickCount: 1 })
    for (let i = 0; i < 6; i++) await A.locator('.top .logo').click()
    for (const c of ctxs) await c.clock.setFixedTime(new Date('2026-10-20T20:05:00'))
    await btn(A, 'Réinitialiser').click()
    const link = await grab(A)
    await deliver(B, link)
    await tab(A, 'Tâche du jour')
    await tab(B, 'Tâche du jour')
    await btn(A, 'Demander ton mood').waitFor()
    await btn(B, 'Demander ton mood').waitFor()
    assert.doesNotMatch(await panel(A), /sans tâche/)
    await open(A, PIN_A, 'Dom')
    assert.strictEqual(await A.locator('.top .pill').innerText(), 'Dom')
  })

  await check('Sécurité : lien modifié refusé', async () => {
    const link = await send(A)
    const i = link.indexOf('#m=') + 40
    const bad = link.slice(0, i) + (link[i] === 'A' ? 'B' : 'A') + link.slice(i + 1)
    assert.match(await deliver(B, bad), /ne vient pas de ton partenaire/)
  })

  await check('Sécurité : son propre lien (ou celui d’un tiers) refusé', async () => {
    const link = await send(A)
    assert.match(await deliver(A, link), /ne vient pas de ton partenaire/)
  })

  await check('Sécurité : lien ouvert app fermée → « Un message t’attend », appliqué après le PIN', async () => {
    const link = await send(A)
    await B.goto('about:blank')
    await B.goto(link)
    await B.getByText("Un message t'attend.").waitFor()
    assert.strictEqual(new URL(B.url()).hash, '', 'code removed from the address bar')
    await B.getByLabel('Code PIN').fill(PIN_B)
    await btn(B, 'Ouvrir').click()
    await B.locator('.notice').waitFor()
    await B.locator('.notice').click()
  })

  await check('Recevoir en un geste : le message copié est lu depuis le presse-papiers', async () => {
    const link = await send(A)
    await B.evaluate((l) => (window.__clip = l), link)
    await B.locator('.sync button', { hasText: 'Recevoir' }).click()
    const n = B.locator('.notice')
    await n.waitFor()
    assert.match(await n.innerText(), /Maitre/)
    await n.click()
  })

  await check('Lien ouvert hors de l’app (Safari) : seul « Transférer à l’app » est proposé, même avec un profil', async () => {
    const link = await send(A)
    const C = await browserB.newContext()
    await C.addInitScript(() => {
      if (navigator.clipboard) navigator.clipboard.writeText = async (t) => void (window.__l = t)
    })
    const c = await C.newPage()
    await c.goto(BASE)
    await create(c, 'Safari', '111111')
    await c.locator('.roles').waitFor()
    await c.goto('about:blank')
    await c.goto(link)
    await c.getByText('Message reçu').waitFor()
    assert.deepStrictEqual(await c.getByRole('button').allInnerTexts(), ["Transférer à l'app"])
    assert.strictEqual(await c.getByLabel('Code PIN').count(), 0)
    await btn(c, "Transférer à l'app").click()
    assert.strictEqual(await c.evaluate(() => window.__l), link)
    await C.close()
  })

  await check('Réglages : délier le couple (prévient l’autre)', async () => {
    await A.getByRole('button', { name: 'Réglages' }).click()
    await A.getByText("Mon QR d'appairage").click()
    await A.locator('.sheet .qr svg').waitFor()
    await btn(A, 'Délier le couple').click()
    await btn(A, /^Oui, délier/).click()
    const link = await grab(A)
    await tab(A, 'Question du jour')
    assert.match(await panel(A), /Liez vos deux téléphones/)
    assert.match(await deliver(B, link), /a délié le couple/)
    assert.match(await panel(B), /Liez vos deux téléphones/)
  })

  await check('Effacement : absent de l’écran du PIN, caché dans les réglages, confirmation « EFFACER » exigée', async () => {
    await B.getByRole('button', { name: 'Verrouiller' }).click()
    await B.getByText('Entre ton code').waitFor()
    assert.strictEqual(await B.getByText(/panique|effacer/i).count(), 0)
    await open(B, PIN_B, 'Sub')
    await B.getByRole('button', { name: 'Réglages' }).click()
    assert.ok(!(await btn(B, 'Tout effacer').isVisible()), 'hidden until « Zone sensible » is opened')
    await B.getByText('Zone sensible').click()
    assert.ok(await btn(B, 'Tout effacer').isDisabled())
    await B.getByPlaceholder('EFFACER').fill('effac')
    assert.ok(await btn(B, 'Tout effacer').isDisabled())
    await B.getByPlaceholder('EFFACER').fill('effacer')
    await btn(B, 'Tout effacer').click()
    await B.getByText('Bienvenue').waitFor()
    const dbs = await B.evaluate(() => indexedDB.databases())
    assert.ok(!dbs.some((d) => d.name === 'bm'), 'database deleted')
  })


  await check('Confidentialité : aucune requête vers un autre domaine', async () => {
    assert.deepStrictEqual(foreign, [])
  })

  await check('Aucune erreur JavaScript pendant tout le test', async () => {
    assert.deepStrictEqual(errors, [], errors.join(' | '))
  })
} catch (e) {
  results.push(['FAIL', 'Étape hors vérification', e.message.split('\n')[0]])
  failed = true
} finally {
  await browserA?.close()
  await browserB.close()
  server.kill()
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/f', '/t'], { stdio: 'ignore' })
}

for (const [s, name, why] of results) console.log(`${s} ${name}${why ? `\n       → ${why}` : ''}`)
const ok = results.filter((r) => r[0] === 'OK  ').length
console.log(`\n${ok}/${results.length} vérifications réussies`)
process.exit(failed ? 1 : 0)
