import { deriveKey, seal, unseal, type Sealed } from './crypto'
import { newKeyPair } from './envelope'
import type { Ev, Role } from './logic'

// One IndexedDB store, one encrypted record. Nothing readable without the PIN.
export type Partner = { id: string; pseudo: string; pub: string; pairedAt: string; role?: Role; roleDay?: string }
export type State = {
  profile: { pseudo: string; createdAt: string }
  me: { id: string; priv: JsonWebKey; pub: string }
  partner?: Partner
  events: Ev[]
  unsent: boolean
}
export type Session = { key: CryptoKey; salt: Uint8Array<ArrayBuffer>; state: State }

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

// Checked without opening (which would recreate an empty database after a panic wipe).
export const hasProfile = async () => (await indexedDB.databases()).some((d) => d.name === DB) && !!(await load())

// ponytail: re-encrypts the whole state on every change; split per day if it ever gets slow.
export async function save(s: Session) {
  const sealed = await seal(s.key, s.salt, s.state)
  await tx('readwrite', (st) => st.put(sealed, 'vault'))
}

export async function createProfile(pseudo: string, pin: string): Promise<Session> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(pin, salt)
  const state: State = {
    profile: { pseudo, createdAt: new Date().toISOString() },
    me: { id: crypto.randomUUID(), ...(await newKeyPair()) },
    events: [],
    unsent: false,
  }
  const s = { key, salt, state }
  await save(s)
  return s
}

export async function unlock(pin: string): Promise<Session | null> {
  const sealed = await load()
  if (!sealed) return null
  const key = await deriveKey(pin, sealed.salt)
  try {
    return { key, salt: sealed.salt, state: await unseal<State>(key, sealed) }
  } catch {
    return null
  }
}

export const wipe = () =>
  new Promise<void>((ok) => {
    const req = indexedDB.deleteDatabase(DB)
    req.onsuccess = req.onerror = req.onblocked = () => ok()
  })
