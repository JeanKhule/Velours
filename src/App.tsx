import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import logoSvg from './logo.svg?raw'
import { createProfile, hasProfile, unlock, type Session } from './vault'

type Role = 'Dom' | 'Switch' | 'Sub'
type Stage = 'loading' | 'setup' | 'locked' | 'role' | 'home'

const Logo = ({ size = 72 }: { size?: number }) => (
  <span className="logo" style={{ width: size }} aria-hidden dangerouslySetInnerHTML={{ __html: logoSvg }} />
)

export default function App() {
  const [stage, setStage] = useState<Stage>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role | null>(null)

  useEffect(() => {
    hasProfile().then((yes) => setStage(yes ? 'locked' : 'setup'))
  }, [])

  // Lock as soon as the app leaves the screen: the key only lives in memory.
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

  const opened = (s: Session) => {
    setSession(s)
    setStage('role')
  }

  if (stage === 'loading') return <Screen><Logo /></Screen>
  if (stage === 'setup') return <Setup onDone={opened} />
  if (stage === 'locked' || !session) return <Unlock onDone={opened} />
  if (stage === 'role' || !role)
    return <RoleChoice pseudo={session.profile.pseudo} onPick={(r) => { setRole(r); setStage('home') }} />
  return <Home pseudo={session.profile.pseudo} role={role} onLock={() => { setSession(null); setRole(null); setStage('locked') }} onRole={() => setStage('role')} />
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
      <form className="card stack" onSubmit={submit}>
        <PinInput label="Code PIN" value={pin} onChange={setPin} autoFocus />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy || pin.length < 6}>{busy ? 'Déchiffrement…' : 'Ouvrir'}</button>
      </form>
    </Screen>
  )
}

const ROLES: { role: Role; line: string }[] = [
  { role: 'Dom', line: 'Je demande le mood et je donne la tâche.' },
  { role: 'Switch', line: 'Je donne ou je reçois, selon le jeu.' },
  { role: 'Sub', line: 'Je donne mon mood et je reçois la tâche.' },
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

function Home(props: { pseudo: string; role: Role; onLock: () => void; onRole: () => void }) {
  const [tab, setTab] = useState<Tab>('Question du jour')
  const tokens = 0 // ponytail: placeholder until tasks exist (phase 2)

  return (
    <div className="home">
      <header className="top">
        <Logo size={40} />
        <div className="who">
          <span className="pseudo">{props.pseudo}</span>
          <button className="pill" onClick={props.onRole} title="Changer de rôle">{props.role}</button>
        </div>
        {props.role !== 'Dom' && <span className="token" title="Tokens punition">{tokens} <small>token{tokens > 1 ? 's' : ''}</small></span>}
        <button className="ghost" onClick={props.onLock} aria-label="Verrouiller" title="Verrouiller">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="1.6" d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>
        </button>
      </header>

      <section className="panel" key={tab}>
        <h1>{tab}</h1>
        {tab === 'Question du jour' && <Locked text="Liez vos deux téléphones pour recevoir votre première question." />}
        {tab === 'Tâche du jour' && <Locked text="La demande de mood et la tâche s'ouvriront une fois le couple lié." />}
        {tab === 'Contrat' && <Empty text="Votre contrat sera scellé le jour du jumelage." />}
        {tab === 'Historique' && <Empty text="Aucune tâche pour l'instant." />}
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} aria-current={t === tab} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
    </div>
  )
}

const Locked = ({ text }: { text: string }) => (
  <div className="card arch">
    <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="1.5" d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>
    <p>{text}</p>
    <button className="btn" disabled>Appairer (bientôt)</button>
  </div>
)

const Empty = ({ text }: { text: string }) => (
  <div className="card arch"><p>{text}</p></div>
)
