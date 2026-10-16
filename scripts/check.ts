// Run: node scripts/check.ts — crypto, envelopes and game rules.
import assert from 'node:assert'
import { deriveKey, seal, unseal } from '../src/crypto.ts'
import { newKeyPair, sharedKey, sealEnvelope, openEnvelope, safetyCode, extractCode } from '../src/envelope.ts'
import { loops, tokens, canRequestMood, contractLine, questionOfDay, prune, type Ev } from '../src/logic.ts'

// Vault: right PIN opens, wrong PIN fails, nothing in clear.
const salt = crypto.getRandomValues(new Uint8Array(16))
const good = await deriveKey('123456', salt, 1000)
const box = await seal(good, salt, { pseudo: 'Velours' })
assert.deepStrictEqual(await unseal(good, box), { pseudo: 'Velours' })
assert.ok(!new TextDecoder().decode(box.data).includes('Velours'))
await assert.rejects(unseal(await deriveKey('654321', salt, 1000), box))

// Pairing: both sides derive the same key; a third phone cannot read.
const a = await newKeyPair(), b = await newKeyPair(), eve = await newKeyPair()
const env = await sealEnvelope(await sharedKey(a.priv, b.pub), { hi: 'là' })
assert.deepStrictEqual(await openEnvelope(await sharedKey(b.priv, a.pub), env), { hi: 'là' })
await assert.rejects(openEnvelope(await sharedKey(eve.priv, a.pub), env))
assert.strictEqual(await safetyCode(a.pub, b.pub), await safetyCode(b.pub, a.pub))
assert.strictEqual(extractCode(`https://x.github.io/bm/#m=${env}`), env)

// Rules.
let n = 0
const ev = (by: string, day: string, e: any): Ev => ({ id: `e${n++}`, by, at: `${day}T10:0${n % 10}`, day, ...e })
const D1 = '2026-10-15', D2 = '2026-10-16'
const req = ev('dom', D1, { type: 'moodRequest', role: 'Dom' })
const log: Ev[] = [req, ev('sub', D1, { type: 'mood', req: req.id, role: 'Sub', envie: 3, temps: 2 }), ev('dom', D1, { type: 'task', req: req.id, text: 'x' })]
assert.strictEqual(loops(log, D1)[0].status, 'encours')
assert.strictEqual(loops(log, D2)[0].status, 'nonrealisee')
assert.strictEqual(tokens(log, 'sub', D2), 1)
assert.strictEqual(tokens([...log, ev('dom', D2, { type: 'tokenUse' })], 'sub', D2), 0)
assert.strictEqual(tokens([...log, ev('sub', D1, { type: 'safeword' })], 'sub', D2), 0, 'safeword never costs a token')
assert.ok(!canRequestMood(log, 'dom', 'Dom', 'Sub', D1), 'one request per day')
assert.ok(!canRequestMood(log, 'sub', 'Switch', 'Dom', D1), 'partner already asked today')
const sw = [ev('a', D2, { type: 'moodRequest', role: 'Switch' })]
assert.ok(canRequestMood(sw, 'b', 'Switch', 'Switch', D2), 'two Switch: second may ask too')
assert.ok(!canRequestMood([], 'a', 'Sub', 'Dom', D2) && canRequestMood([], 'a', 'Sub', 'Sub', D2))
const dd = ev('a', D2, { type: 'moodRequest', role: 'Dom' })
assert.strictEqual(loops([dd, ev('b', D2, { type: 'mood', req: dd.id, role: 'Dom', envie: 1, temps: 1 })], D2)[0].status, 'sanstache')
assert.strictEqual(contractLine('A', 'B', 'Sub', 'Dom'), 'Moi, A, appartiens à B.')
assert.strictEqual(contractLine('A', 'B', 'Switch', 'Sub'), 'Moi, A, prends possession de B.')
const bank = ['q1', 'q2', 'q3']
assert.strictEqual(questionOfDay([], 'seed', D2, bank).text, questionOfDay([], 'seed', D2, bank).text)
assert.strictEqual(questionOfDay([ev('a', D2, { type: 'question', text: 'mienne' })], 'seed', D2, bank).text, 'mienne')
// Secret reset: today's game is wiped (even if resent later), other days and signatures stay.
const old = { ...ev('a', D2, { type: 'moodRequest', role: 'Dom' }), at: '2026-10-16T10:00' }
const sign = { ...ev('a', D2, { type: 'sign', path: 'M0 0' }), at: '2026-10-16T10:00' }
const reset = { ...ev('a', D2, { type: 'reset' }), at: '2026-10-16T11:00' }
const after = { ...ev('a', D2, { type: 'moodRequest', role: 'Dom' }), at: '2026-10-16T12:00' }
assert.deepStrictEqual(prune([old, sign, reset, after, req]).map((e) => e.id), [sign.id, reset.id, after.id, req.id])
console.log('all checks ok')

// The pairing QR must decode with the scanner we ship.
import qrcode from 'qrcode-generator'
import jsQR from 'jsqr'
const card = 'BM1.' + 'x'.repeat(200)
const qr = qrcode(0, 'M'); qr.addData(card); qr.make()
const cell = 4, m = qr.getModuleCount(), size = (m + 8) * cell
const px = new Uint8ClampedArray(size * size * 4).fill(255)
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const r = Math.floor(y / cell) - 4, c = Math.floor(x / cell) - 4
  if (r >= 0 && c >= 0 && r < m && c < m && qr.isDark(r, c)) px.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3)
}
assert.strictEqual(jsQR(px, size, size)?.data, card)
console.log('qr ok')
