// Game rules, as pure functions over the shared event log. No I/O here.

export type Role = 'Dom' | 'Switch' | 'Sub'

type Base = { id: string; by: string; at: string; day: string }
export type Ev = Base &
  (
    | { type: 'question'; text: string }
    | { type: 'answer'; text: string }
    | { type: 'chat'; text: string }
    | { type: 'moodRequest'; role: Role }
    | { type: 'mood'; req: string; role: Role; envie: number; temps: number }
    | { type: 'task'; req: string; text: string }
    | { type: 'done'; req: string; plu: number; pendant: number; apres: number; comment: string }
    | { type: 'safeword' }
    | { type: 'tokenUse' }
    | { type: 'sign'; path: string }
    | { type: 'unlink' }
    | { type: 'reset' } // secret test tool: wipes the day's game on both phones
  )
export type EvOf<T extends Ev['type']> = Extract<Ev, { type: T }>
export type NewEv = Ev extends infer E ? (E extends Ev ? Omit<E, keyof Base> : never) : never

const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const of = <T extends Ev['type']>(events: Ev[], type: T, day?: string) =>
  events.filter((e): e is EvOf<T> => e.type === type && (!day || e.day === day))

// Deterministic: both phones show the same bank question without talking.
export function bankIndex(seed: string, day: string, size: number) {
  let h = 2166136261
  for (const c of seed + day) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) % size
}

export function questionOfDay(events: Ev[], seed: string, day: string, bank: string[]) {
  const own = of(events, 'question', day).sort((a, b) => a.at.localeCompare(b.at)).pop()
  return own ? { text: own.text, custom: true } : { text: bank[bankIndex(seed, day, bank.length)], custom: false }
}

// Drops the day's game events older than a reset of that day, so resent links cannot bring them back.
const DAILY = new Set<Ev['type']>(['question', 'answer', 'chat', 'moodRequest', 'mood', 'task', 'done', 'safeword'])
export const prune = (events: Ev[]) => {
  const resets = events.filter((e) => e.type === 'reset')
  return events.filter((e) => !DAILY.has(e.type) || !resets.some((r) => r.day === e.day && e.at < r.at))
}

export const safeworded = (events: Ev[], day: string) => of(events, 'safeword', day).length > 0

export type LoopStatus = 'mood' | 'tache' | 'encours' | 'fait' | 'nonrealisee' | 'safeword' | 'sanstache'
export type Loop = {
  req: EvOf<'moodRequest'>
  mood?: EvOf<'mood'>
  task?: EvOf<'task'>
  done?: EvOf<'done'>
  status: LoopStatus
}

// A task only follows when roles complement each other (two Dom or two Sub: mood only).
export const taskAllowed = (giver: Role, receiver: Role) => !(giver === receiver && giver !== 'Switch')

export function loops(events: Ev[], today: string): Loop[] {
  return of(events, 'moodRequest').map((req) => {
    const mood = of(events, 'mood').find((e) => e.req === req.id)
    const task = of(events, 'task').find((e) => e.req === req.id)
    const done = of(events, 'done').find((e) => e.req === req.id)
    const sw = safeworded(events, req.day)
    const status: LoopStatus = done
      ? 'fait'
      : sw
        ? 'safeword'
        : !mood
          ? 'mood'
          : !taskAllowed(req.role, mood.role)
            ? 'sanstache'
            : !task
              ? 'tache'
              : req.day < today
                ? 'nonrealisee'
                : 'encours'
    return { req, mood, task, done, status }
  })
}

// One mood request per day per couple; two Switch may each make one.
export function canRequestMood(events: Ev[], me: string, myRole: Role, partnerRole: Role | undefined, day: string) {
  if (safeworded(events, day)) return false
  if (myRole === 'Sub' && partnerRole !== 'Sub') return false
  const today = of(events, 'moodRequest', day)
  if (today.some((e) => e.by === me)) return false
  return today.length === 0 || (myRole === 'Switch' && today.every((e) => e.role === 'Switch'))
}

// Tokens owed by `who`: every task they let expire, minus those the giver struck off.
export function tokens(events: Ev[], who: string, today: string) {
  const missed = loops(events, today).filter((l) => l.status === 'nonrealisee' && l.req.by !== who).length
  const used = of(events, 'tokenUse').filter((e) => e.by !== who).length
  return Math.max(0, missed - used)
}

export function contractLine(me: string, them: string, mine: Role, theirs: Role = 'Switch') {
  if (mine === theirs) {
    if (mine === 'Dom') return `Moi, ${me}, défie ${them} de me faire plier.`
    if (mine === 'Sub') return `Moi, ${me}, m'abandonne avec ${them} à qui voudra de nous.`
    return `Moi, ${me}, déclare vouloir me pervertir avec ${them}.`
  }
  const submits = mine === 'Sub' || theirs === 'Dom'
  return submits ? `Moi, ${me}, appartiens à ${them}.` : `Moi, ${me}, prends possession de ${them}.`
}

export const signatures = (events: Ev[]) => of(events, 'sign')

export const ENVIE = [
  'Juste une caresse, pas plus',
  'Ça commence à me chauffer entre les cuisses',
  "Je suis trempé·e / raide, j'en veux",
  'Je suis ta chose, utilise‑moi sans retenue',
]
export const TEMPS = [
  'Un coup rapide, quelques secondes',
  'Une petite pause salace',
  "J'ai du temps, prends le temps de me dresser",
  'Tout mon temps est à toi, use et abuse de moi',
]
