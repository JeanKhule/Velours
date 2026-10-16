// All local data is sealed with AES-GCM under a key derived from the PIN (PBKDF2-SHA256).
export const ITERATIONS = 600_000

export type Sealed = { salt: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }

export async function deriveKey(pin: string, salt: Uint8Array<ArrayBuffer>, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function seal(key: CryptoKey, salt: Uint8Array<ArrayBuffer>, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  return { salt, iv, data }
}

// Throws on a wrong key (GCM authentication fails).
export async function unseal<T>(key: CryptoKey, s: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, key, s.data)
  return JSON.parse(new TextDecoder().decode(plain))
}
