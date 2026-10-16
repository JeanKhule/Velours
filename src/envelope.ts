// Pairing keys (ECDH P-256, exchanged face to face by QR) and sealed envelopes
// (deflate + AES-GCM under the shared key). Self-contained: only WebCrypto + native streams.

export const b64u = {
  enc: (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

export async function newKeyPair() {
  const kp = (await crypto.subtle.generateKey(ECDH, true, ['deriveKey'])) as CryptoKeyPair
  return {
    priv: await crypto.subtle.exportKey('jwk', kp.privateKey),
    pub: b64u.enc(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
  }
}

// Both phones derive the same AES key from their own private key and the other's public key.
export async function sharedKey(priv: JsonWebKey, theirPub: string) {
  const mine = await crypto.subtle.importKey('jwk', priv, ECDH, false, ['deriveKey'])
  const theirs = await crypto.subtle.importKey('raw', b64u.dec(theirPub), ECDH, false, [])
  return crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, mine, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// Short code both screens show after pairing, to check nobody swapped a QR.
export async function safetyCode(pubA: string, pubB: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([pubA, pubB].sort().join('|'))))
  return String(((h[0] << 16) | (h[1] << 8) | h[2]) % 1_000_000).padStart(6, '0')
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer())
}

export async function sealEnvelope(key: CryptoKey, value: unknown): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream('deflate-raw'))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed as BufferSource))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return b64u.enc(out)
}

// Throws if the envelope was not sealed with this key or was tampered with.
export async function openEnvelope<T>(key: CryptoKey, sealed: string): Promise<T> {
  const raw = b64u.dec(sealed)
  const packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12))
  return JSON.parse(new TextDecoder().decode(await pipe(new Uint8Array(packed), new DecompressionStream('deflate-raw'))))
}

// Accepts a full link (…#m=XXX), "m=XXX" or the bare code.
export const extractCode = (text: string) => text.trim().replace(/^.*#m=/, '').replace(/^m=/, '').replace(/[^A-Za-z0-9_-]/g, '')
