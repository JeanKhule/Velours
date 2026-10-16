import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import logoSvg from './logo.svg?raw'
import { createProfile, hasProfile, save, unlock, wipe, type Session, type State } from './vault'
import { extractCode, openEnvelope, safetyCode, sealEnvelope, sharedKey } from './envelope'
import { dayOf, tokens, type Ev, type NewEv, type Role } from './logic'
import { MyQr, Pair } from './Pair'
import { Contract, History, QuestionTab, TaskTab } from './Tabs'

type Stage = 'loading' | 'setup' | 'locked' | 'role' | 'home'

// What one phone sends the other: its identity, today's role and its own recent events.
type Payload = { v: 1; from: string; pseudo: string; role: Role; day: string; events: Ev[] }

export type Ctx = {
  state: State
  role: Role
  today: string
  partnerRole?: Role
  act: (e: NewEv) => void
}

export const Logo = ({ size = 72 }: { size?: number }) => (
  <span className="logo" style={{ width: size }} aria-hidden dangerouslySetInnerHTML={{ __html: logoSvg }} />
)

// A link opened from the messenger: read once, then removed from the address bar.
const incoming = { code: '', link: '' }
function grab() {
  if (!location.hash.startsWith('#m=')) return
  incoming.code = extractCode(location.hash)
  incoming.link = location.href
  history.replaceState(null, '', location.pathname)
}
grab()
addEventListener('hashchange', grab)

// A link opened in the browser (on iPhone: always Safari, never the home-screen app) only offers the transfer.
const installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const bridgeOnly = !!incoming.code && !installed

export default function App() {
  const [stage, setStage] = useState<Stage>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role | null>(null)

  useEffect(() => {
    hasProfile().then((yes) => setStage(yes ? 'locked' : 'setup'))
  }, [])

  // Lock as soon as the app leaves the screen: the keys only live in memory.
  useEffect(() => {
    const lock = () => {
      if (document.visibilityState !== 'hidden') return
      setSession(null)
      setRole(null)
      setStage((s) => (s === 'role' || s === 'home' ? 'locked' : s))
    }
    document.addEventListener('visibilitychange', lock)
    return () => document.removeEventListener('visibilitychange', lock)
  }, [])

  // The role is chosen once per day: reopening the same day goes straight home.
  const opened = (s: Session) => {
    setSession(s)
    const mine = s.state.myRole
    if (mine?.day === dayOf()) {
      setRole(mine.role)
      setStage('home')
    } else setStage('role')
  }

  if (bridgeOnly) return <Bridge />
  if (stage === 'loading') return <Screen><Logo /></Screen>
  if (stage === 'setup') return <Setup onDone={opened} />
  if (stage === 'locked' || !session) return <Unlock onDone={opened} />
  if (stage === 'role' || !role)
    return (
      <RoleChoice
        pseudo={session.state.profile.pseudo}
        onPick={(r) => {
          // Saved (encrypted) so the choice holds for the day; the partner learns it with the next link.
          session.state = { ...session.state, myRole: { role: r, day: dayOf() }, unsent: session.state.partner ? true : session.state.unsent }
          save(session)
          setRole(r)
          setStage('home')
        }}
      />
    )
  return (
    <Home
      session={session}
      role={role}
      onLock={() => {
        setSession(null)
        setRole(null)
        setStage('locked')
      }}
    />
  )
}

function Screen({ children }: { children: ReactNode }) {
  return <main className="screen">{children}</main>
}

const PIN = /^\d{6,8}$/

function PinInput(props: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={props.value}
        autoFocus={props.autoFocus}
        onChange={(e) => props.onChange(e.target.value.replace(/\D/g, ''))}
      />
    </label>
  )
}

// Nothing is read or stored here: the message is only copied, to be received in the app.
function Bridge() {
  const [copied, setCopied] = useState(false)
  return (
    <Screen>
      <Logo size={72} />
      <h1>Message reçu</h1>
      <p className="lead">
        Ce lien s'est ouvert dans le navigateur, pas dans l'app. Transfère‑le, puis ouvre l'app depuis ton écran d'accueil et touche « Recevoir ».
      </p>
      <div className="stack">
        <button
          className="btn"
          onClick={async () => {
            await navigator.clipboard.writeText(incoming.link)
            setCopied(true)
          }}
        >
          {copied ? "Prêt : ouvre l'app ✓" : "Transférer à l'app"}
        </button>
      </div>
    </Screen>
  )
}

function Setup({ onDone }: { onDone: (s: Session) => void }) {
  const [pseudo, setPseudo] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pseudo.trim()) return setError('Choisis un pseudo.')
    if (!PIN.test(pin)) return setError('Le code doit faire 6 à 8 chiffres.')
    if (pin !== pin2) return setError('Les deux codes ne correspondent pas.')
    setBusy(true)
    onDone(await createProfile(pseudo.trim(), pin))
  }

  return (
    <Screen>
      <Logo />
      <h1>Bienvenue</h1>
      <p className="lead">Un pseudo, un code. Aucun e‑mail, aucun compte : tout reste chiffré sur ce téléphone.</p>
      <form className="card stack" onSubmit={submit}>
        <label className="field">
          <span>Pseudo</span>
          <input value={pseudo} maxLength={32} autoComplete="off" autoFocus onChange={(e) => setPseudo(e.target.value)} />
        </label>
        <PinInput label="Code PIN (6 à 8 chiffres)" value={pin} onChange={setPin} />
        <PinInput label="Confirme le code" value={pin2} onChange={setPin2} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Chiffrement…' : 'Créer mon profil'}</button>
      </form>
      <p className="hint">Sans ce code, personne ne peut lire tes données. Toi non plus : ne l'oublie pas.</p>
    </Screen>
  )
}

function Unlock({ onDone }: { onDone: (s: Session) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const s = await unlock(pin)
    setBusy(false)
    if (s) return onDone(s)
    setPin('')
    setError('Code incorrect.')
  }

  return (
    <Screen>
      <Logo size={96} />
      <h1>Entre ton code</h1>
      {incoming.code && <p className="lead">Un message t'attend.</p>}
      <form className="card stack" onSubmit={submit}>
        <PinInput label="Code PIN" value={pin} onChange={setPin} autoFocus />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy || pin.length < 6}>{busy ? 'Déchiffrement…' : 'Ouvrir'}</button>
      </form>
    </Screen>
  )
}

const ROLES: { role: Role; line: string }[] = [
  { role: 'Dom', line: "Ce soir, c'est moi qui tiens la laisse. J'exige ton mood, tu exécutes mes ordres." },
  { role: 'Switch', line: 'Dominer ou plier ? Je ne choisis pas : je veux les deux.' },
  { role: 'Sub', line: "Je suis à toi. Je t'avoue mon envie et j'obéis sans discuter." },
]

function RoleChoice({ pseudo, onPick }: { pseudo: string; onPick: (r: Role) => void }) {
  return (
    <Screen>
      <Logo size={56} />
      <p className="script">{new Date().getHours() < 18 ? 'Bonjour' : 'Bonsoir'} {pseudo}</p>
      <h1>Qui es‑tu aujourd'hui ?</h1>
      <div className="stack roles">
        {ROLES.map(({ role, line }) => (
          <button key={role} className="role" onClick={() => onPick(role)}>
            <strong>{role}</strong>
            <span>{line}</span>
          </button>
        ))}
      </div>
    </Screen>
  )
}

const TABS = ['Question du jour', 'Tâche du jour', 'Contrat', 'Historique'] as const
type Tab = (typeof TABS)[number]

function Home({ session, role, onLock }: { session: Session; role: Role; onLock: () => void }) {
  const [state, setState] = useState(session.state)
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [tab, setTab] = useState<Tab>('Question du jour')
  const [sheet, setSheet] = useState<'' | 'send' | 'receive' | 'settings' | 'pair'>('')
  const [link, setLink] = useState('')
  const [notice, setNotice] = useState('')
  const [unlinking, setUnlinking] = useState(false)
  const today = dayOf()
  const { me, partner } = state
  const partnerRole = partner?.roleDay === today ? partner.role : undefined

  // Every change is saved encrypted right away.
  const update = (f: (s: State) => State) =>
    setState((prev) => {
      const next = f(prev)
      session.state = next
      save(session)
      return next
    })

  useEffect(() => {
    setKey(null)
    if (partner) sharedKey(me.priv, partner.pub).then(setKey)
  }, [partner?.pub])


  const receive = async (code: string) => {
    if (!partner || !key) return setNotice("Liez-vous d'abord pour lire les messages.")
    let p: Payload
    try {
      p = await openEnvelope<Payload>(key, extractCode(code))
    } catch {
      return setNotice("Ce message ne vient pas de ton partenaire, ou il est abîmé.")
    }
    if (p.from !== partner.id) return setNotice("Ce message ne vient pas de ton partenaire.")
    // Only the partner's own events are accepted: nobody can write in your name.
    const known = new Set(state.events.map((e) => e.id))
    const fresh = p.events.filter((e) => e.by === partner.id && !known.has(e.id))
    if (fresh.some((e) => e.type === 'unlink')) {
      update((s) => ({ ...s, partner: undefined }))
      return setNotice(`${partner.pseudo} a délié le couple.`)
    }
    update((s) => ({
      ...s,
      events: [...s.events, ...fresh],
      partner: s.partner && { ...s.partner, pseudo: p.pseudo, role: p.role, roleDay: p.day },
    }))
    setNotice(fresh.length ? `Message de ${p.pseudo} reçu.` : `Rien de nouveau de ${p.pseudo}.`)
  }

  // Links arriving at startup or while the app is open.
  useEffect(() => {
    if (!key) return
    const take = () => {
      if (!incoming.code) return
      receiveRef.current(incoming.code)
      incoming.code = ''
    }
    take()
    addEventListener('hashchange', take)
    return () => removeEventListener('hashchange', take)
  }, [key])
  const receiveRef = useRef(receive)
  receiveRef.current = receive

  // One tap: take the message from the clipboard (iOS opens links in Safari, not in the app); else show the paste field.
  const pasteOrAsk = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (/#m=|^[A-Za-z0-9_-]{40,}$/.test(text)) return receive(text)
    } catch {
      /* clipboard refused: fall back to the paste field */
    }
    setSheet('receive')
  }

  const prepareSend = async () => {
    if (!partner || !key) return
    const since = dayOf(new Date(Date.now() - 864e5))
    const payload: Payload = {
      v: 1,
      from: me.id,
      pseudo: state.profile.pseudo,
      role,
      day: today,
      // ponytail: resends the last two days (plus signatures and struck tokens) so a lost link heals itself.
      events: state.events.filter((e) => e.by === me.id && (e.day >= since || e.type === 'sign' || e.type === 'tokenUse')),
    }
    setLink(`${location.origin}${location.pathname}#m=${await sealEnvelope(key, payload)}`)
    setSheet('send')
  }

  const act = (e: NewEv) => {
    update((s) => ({
      ...s,
      unsent: true,
      events: [...s.events, { ...e, id: crypto.randomUUID(), by: me.id, at: new Date().toISOString(), day: today } as Ev],
    }))
    if (e.type !== 'chat' && e.type !== 'answer' && e.type !== 'question') setTimeout(() => prepareSendRef.current(), 0)
  }
  const prepareSendRef = useRef(prepareSend)
  prepareSendRef.current = prepareSend

  const ctx: Ctx = { state, role, today, partnerRole, act }
  const myTokens = partner ? tokens(state.events, me.id, today) : 0

  if (sheet === 'pair')
    return (
      <Pair
        state={state}
        onPaired={(p) => {
          update((s) => ({ ...s, partner: p, events: [], unsent: true }))
          setSheet('')
          setTab('Contrat')
        }}
        onCancel={() => setSheet('')}
      />
    )

  return (
    <div className="home">
      <header className="top">
        <Logo size={40} />
        <div className="who">
          <span className="pill" title="Rôle du jour">{role}</span>
        </div>
        {partner && (
          <span className="token" title="Tokens punition">
            {myTokens} <small>token{myTokens > 1 ? 's' : ''}</small>
          </span>
        )}
        <button className="ghost" onClick={() => setSheet('settings')} aria-label="Réglages" title="Réglages">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path fill="none" stroke="currentColor" strokeWidth="1.6" d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
        </button>
        <button className="ghost" onClick={onLock} aria-label="Verrouiller" title="Verrouiller">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="1.6" d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>
        </button>
      </header>

      {partner && (
        <div className="sync">
          <span>
            {partner.pseudo} · {partnerRole ?? 'rôle du jour inconnu'}
          </span>
          <button className="ghost small" onClick={pasteOrAsk}>Recevoir</button>
          <button className={`ghost small ${state.unsent ? 'hot' : ''}`} onClick={prepareSend}>
            Envoyer{state.unsent ? ' •' : ''}
          </button>
        </div>
      )}

      {notice && (
        <button className="notice" onClick={() => setNotice('')}>
          {notice}
        </button>
      )}

      <section className="panel" key={tab}>
        <h1>{tab}</h1>
        {!partner ? (
          <Locked onPair={() => setSheet('pair')} />
        ) : tab === 'Question du jour' ? (
          <QuestionTab ctx={ctx} />
        ) : tab === 'Tâche du jour' ? (
          <TaskTab ctx={ctx} />
        ) : tab === 'Contrat' ? (
          <Contract ctx={ctx} />
        ) : (
          <History ctx={ctx} />
        )}
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} aria-current={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {sheet === 'send' && (
        <SendSheet
          link={link}
          to={partner?.pseudo ?? ''}
          onSent={() => update((s) => ({ ...s, unsent: false }))}
          onClose={() => {
            // The unlink notice has been offered to the partner: now forget them.
            if (unlinking) update((s) => ({ ...s, partner: undefined }))
            setUnlinking(false)
            setSheet('')
          }}
        />
      )}
      {sheet === 'receive' && (
        <ReceiveSheet
          onCode={(c) => {
            receive(c)
            setSheet('')
          }}
          onClose={() => setSheet('')}
        />
      )}
      {sheet === 'settings' && (
        <Settings
          state={state}
          onPair={() => setSheet('pair')}
          onUnlink={() => {
            setUnlinking(true)
            act({ type: 'unlink' })
          }}
          onClose={() => setSheet('')}
        />
      )}
    </div>
  )
}

const Locked = ({ onPair }: { onPair: () => void }) => (
  <div className="card arch">
    <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="1.5" d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>
    <p>Liez vos deux téléphones, face à face, pour ouvrir le jeu.</p>
    <button className="btn" onClick={onPair}>Appairer</button>
  </div>
)

export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        <button className="ghost wide" onClick={onClose}>Fermer</button>
      </div>
    </div>
  )
}

function SendSheet({ link, to, onSent, onClose }: { link: string; to: string; onSent: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    onSent()
    try {
      await navigator.share({ url: link })
    } catch {
      /* cancelled: the link stays available below */
    }
  }
  const copy = async () => {
    await navigator.clipboard.writeText(link)
    onSent()
    setCopied(true)
  }
  return (
    <Sheet title={`Envoyer à ${to}`} onClose={onClose}>
      <p className="hint left">
        Le message est scellé : seul le téléphone de {to} peut l'ouvrir. Envoie‑le par la messagerie de ton choix.
      </p>
      {'share' in navigator && <button className="btn" onClick={share}>Partager</button>}
      <button className="ghost wide" onClick={copy}>{copied ? 'Copié ✓' : 'Copier le lien'}</button>
    </Sheet>
  )
}

function ReceiveSheet({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  return (
    <Sheet title="Recevoir un message" onClose={onClose}>
      <p className="hint left">Colle ici le lien reçu. Il ne s'ouvre qu'avec la clé de votre couple.</p>
      <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…#m=…" />
      <button className="btn" disabled={!extractCode(text)} onClick={() => onCode(text)}>Ouvrir</button>
    </Sheet>
  )
}

function Settings(props: { state: State; onPair: () => void; onUnlink: () => void; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [confirm, setConfirm] = useState(false)
  const { partner, me } = props.state
  useEffect(() => {
    if (partner) safetyCode(me.pub, partner.pub).then(setCode)
  }, [])
  return (
    <Sheet title="Réglages" onClose={props.onClose}>
      {partner ? (
        <>
          <p className="hint left">
            Lié·e à <strong>{partner.pseudo}</strong> depuis le {new Date(partner.pairedAt).toLocaleDateString('fr-FR')}. Code de sécurité :{' '}
            <strong>{code}</strong>
          </p>
          <details className="manual">
            <summary>Mon QR d'appairage</summary>
            <MyQr state={props.state} />
          </details>
          {confirm ? (
            <button className="btn" onClick={props.onUnlink}>Oui, délier (votre jeu sera effacé)</button>
          ) : (
            <button className="ghost wide" onClick={() => setConfirm(true)}>Délier le couple</button>
          )}
        </>
      ) : (
        <button className="btn" onClick={props.onPair}>Appairer</button>
      )}
      <details className="manual">
        <summary>Zone sensible</summary>
        <Panic />
      </details>
    </Sheet>
  )
}

// Wipes this phone. Tucked away in settings, behind a typed confirmation so it never fires by accident.
function Panic() {
  const [word, setWord] = useState('')
  const panic = async () => {
    await wipe()
    location.replace(location.pathname)
  }
  return (
    <>
      <p className="hint left">Efface tout de ce téléphone, sans retour possible. Écris EFFACER pour confirmer.</p>
      <input className="input" value={word} autoComplete="off" placeholder="EFFACER" onChange={(e) => setWord(e.target.value.toUpperCase())} />
      <button className="btn panic" disabled={word !== 'EFFACER'} onClick={panic}>Tout effacer</button>
    </>
  )
}
