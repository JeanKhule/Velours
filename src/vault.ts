import { deriveKey, seal, unseal, type Sealed } from './crypto'

// One IndexedDB store, one encrypted record. Nothing readable without the PIN.
export type Profile = { pseudo: string; createdAt: string }
export type Session = { key: CryptoKey; salt: Uint8Array<ArrayBuffer>; profile: Profile }

const DB = 'bm'
const STORE = 'kv'

function db(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => ok(req.result)
    req.onerror = () => ko(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db()
  return new Promise((ok, ko) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => ok(req.result)
    req.onerror = () => ko(req.error)
  })
}

const load = () => tx<Sealed | undefined>('readonly', (s) => s.get('vault'))

export const hasProfile = async () => !!(await load())

export async function createProfile(pseudo: string, pin: string): Promise<Session> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(pin, salt)
  const profile = { pseudo, createdAt: new Date().toISOString() }
  const sealed = await seal(key, salt, profile)
  await tx('readwrite', (s) => s.put(sealed, 'vault'))
  return { key, salt, profile }
}

export async function unlock(pin: string): Promise<Session | null> {
  const sealed = await load()
  if (!sealed) return null
  const key = await deriveKey(pin, sealed.salt)
  try {
    return { key, salt: sealed.salt, profile: await unseal<Profile>(key, sealed) }
  } catch {
    return null
  }
}

export const wipe = () =>
  new Promise<void>((ok) => {
    const req = indexedDB.deleteDatabase(DB)
    req.onsuccess = req.onerror = req.onblocked = () => ok()
  })
