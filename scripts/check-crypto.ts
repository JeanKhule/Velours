// Run: node scripts/check-crypto.ts
import assert from 'node:assert'
import { deriveKey, seal, unseal } from '../src/crypto.ts'

const salt = crypto.getRandomValues(new Uint8Array(16))
const good = await deriveKey('123456', salt, 1000)
const bad = await deriveKey('654321', salt, 1000)
const box = await seal(good, salt, { pseudo: 'Velours' })
assert.deepStrictEqual(await unseal(good, box), { pseudo: 'Velours' })
assert.ok(!new TextDecoder().decode(box.data).includes('Velours'), 'plaintext leaked')
await assert.rejects(unseal(bad, box), 'wrong PIN must not decrypt')
console.log('crypto ok')
