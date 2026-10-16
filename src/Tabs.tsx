import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { Ctx } from './App'
import { Logo } from './App'
import { QUESTIONS } from './questions'
import {
  ENVIE,
  TEMPS,
  canRequestMood,
  contractLine,
  loops,
  questionOfDay,
  safeworded,
  signatures,
  tokens,
  type Ev,
  type Loop,
} from './logic'

const seedOf = (ctx: Ctx) => [ctx.state.me.id, ctx.state.partner!.id].sort().join('|')
const fmtDay = (day: string) => new Date(day + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const byAt = (a: Ev, b: Ev) => a.at.localeCompare(b.at)

// Leather strap with 4 eyelets, filled in red latex up to a heart-padlock cursor.
function Slider(props: { label: string; value: number; onChange: (n: number) => void; levels?: string[] }) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <div className="track" style={{ '--p': (props.value - 1) / 3 } as CSSProperties}>
        <i className="fill" />
        {[0, 1, 2, 3].map((k) => (
          <b key={k} className={k < props.value ? 'eyelet on' : 'eyelet'} style={{ '--k': k / 3 } as CSSProperties} />
        ))}
        <input type="range" min={1} max={4} step={1} value={props.value} onChange={(e) => props.onChange(+e.target.value)} />
      </div>
      <em key={props.value}>{props.levels ? props.levels[props.value - 1] : `${props.value} / 4`}</em>
    </label>
  )
}

function TextBox(props: { placeholder: string; max: number; cta: string; onSend: (t: string) => void; rows?: number }) {
  const [text, setText] = useState('')
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        props.onSend(text.trim())
        setText('')
      }}
    >
      <textarea className="input" rows={props.rows ?? 3} maxLength={props.max} placeholder={props.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" disabled={!text.trim()}>{props.cta}</button>
    </form>
  )
}

/* ---------- Question du jour ---------- */

export function QuestionTab({ ctx }: { ctx: Ctx }) {
  const { state, today, act } = ctx
  const partner = state.partner!
  const [own, setOwn] = useState(false)
  const q = questionOfDay(state.events, seedOf(ctx), today, QUESTIONS)
  const day = state.events.filter((e) => e.day === today)
  const mine = day.find((e) => e.type === 'answer' && e.by === state.me.id)
  const theirs = day.find((e) => e.type === 'answer' && e.by === partner.id)
  const chat = day.filter((e) => e.type === 'chat').sort(byAt)

  return (
    <div className="stack wide-stack">
      <div className="card question">
        <p className="kicker">{q.custom ? 'Votre question' : 'Question de la banque'}</p>
        <p className="q">{q.text}</p>
        {!mine && !theirs && !own && (
          <button className="ghost small" onClick={() => setOwn(true)}>J'ai ma question</button>
        )}
      </div>
      {own && !mine && (
        <TextBox
          placeholder="Ta question pour aujourd'hui"
          max={200}
          cta="Poser cette question"
          onSend={(text) => {
            act({ type: 'question', text })
            setOwn(false)
          }}
        />
      )}

      {mine ? (
        <div className="card">
          <p className="kicker">Ta réponse</p>
          <p>{'text' in mine && mine.text}</p>
        </div>
      ) : (
        <TextBox placeholder="Ta réponse (courte)" max={280} cta="Répondre" onSend={(text) => act({ type: 'answer', text })} />
      )}

      <div className="card">
        <p className="kicker">Réponse de {partner.pseudo}</p>
        {!theirs ? (
          <p className="muted">Pas encore reçue.</p>
        ) : mine ? (
          <p>{'text' in theirs && theirs.text}</p>
        ) : (
          <p className="muted veiled">{partner.pseudo} a répondu. Réponds pour découvrir.</p>
        )}
      </div>

      {mine && (
        <div className="card chat">
          <p className="kicker">Messagerie du jour</p>
          {chat.map((m) => (
            <p key={m.id} className={m.by === state.me.id ? 'bubble me' : 'bubble'}>
              {'text' in m && m.text}
            </p>
          ))}
          <TextBox placeholder="Écris…" max={1000} cta="Ajouter" rows={2} onSend={(text) => act({ type: 'chat', text })} />
          <p className="hint left">Tes messages partent quand tu appuies sur « Envoyer ».</p>
        </div>
      )}
    </div>
  )
}

/* ---------- Tâche du jour ---------- */

export function TaskTab({ ctx }: { ctx: Ctx }) {
  const { state, today, role, partnerRole, act } = ctx
  const todays = loops(state.events, today).filter((l) => l.req.day === today)
  const stopped = safeworded(state.events, today)

  return (
    <div className="stack wide-stack">
      {stopped && (
        <div className="card arch">
          <p className="script">Safeword</p>
          <p>Le jeu s'arrête pour aujourd'hui. Prenez le temps d'en parler : la question du jour et sa messagerie restent ouvertes.</p>
        </div>
      )}
      {todays.map((l) => (
        <LoopCard key={l.req.id} loop={l} ctx={ctx} />
      ))}
      {canRequestMood(state.events, state.me.id, role, partnerRole, today) && (
        <div className="card arch">
          <p>Envie de savoir où en est {state.partner!.pseudo} ?</p>
          <button className="btn" onClick={() => act({ type: 'moodRequest', role })}>Demander ton mood</button>
        </div>
      )}
      {!stopped && todays.length === 0 && !canRequestMood(state.events, state.me.id, role, partnerRole, today) && (
        <div className="card arch">
          <p>En attente d'une demande de mood de {state.partner!.pseudo}.</p>
        </div>
      )}
      {/* The safeword refuses a task: only once one has actually been received. */}
      {!stopped && todays.some((l) => l.req.by !== state.me.id && l.status === 'encours') && <Safeword act={act} />}
    </div>
  )
}

function Safeword({ act }: { act: Ctx['act'] }) {
  const [armed, setArmed] = useState(false)
  return armed ? (
    <button className="btn panic" onClick={() => act({ type: 'safeword' })}>Prononcer le safeword (fin du jeu aujourd'hui)</button>
  ) : (
    <button className="ghost wide danger" onClick={() => setArmed(true)}>Safeword</button>
  )
}

const moodLine = (l: Loop) => (l.mood ? `Envie ${l.mood.envie}/4 · Temps ${l.mood.temps}/4` : '')

function LoopCard({ loop: l, ctx }: { loop: Loop; ctx: Ctx }) {
  const { state, role, act } = ctx
  const giver = l.req.by === state.me.id
  const them = state.partner!.pseudo
  const [envie, setEnvie] = useState(2)
  const [temps, setTemps] = useState(2)
  const [doing, setDoing] = useState(false)
  const [fb, setFb] = useState({ plu: 3, pendant: 3, apres: 3, comment: '' })

  if (l.status === 'mood')
    return giver ? (
      <div className="card arch"><p>Demande envoyée. En attente du mood de {them}.</p></div>
    ) : (
      <div className="card stack-in">
        <p className="kicker">{them} demande ton mood</p>
        <Slider label="Envie" value={envie} onChange={setEnvie} levels={ENVIE} />
        <Slider label="Temps disponible" value={temps} onChange={setTemps} levels={TEMPS} />
        <button className="btn" onClick={() => act({ type: 'mood', req: l.req.id, role, envie, temps })}>Valider</button>
      </div>
    )

  const moodCard = l.mood && (
    <div className="card">
      <p className="kicker">Mood de {giver ? them : 'toi'}</p>
      <p><strong>Envie :</strong> {ENVIE[l.mood.envie - 1]}</p>
      <p><strong>Temps :</strong> {TEMPS[l.mood.temps - 1]}</p>
    </div>
  )

  if (l.status === 'sanstache')
    return (
      <>
        {moodCard}
        <div className="card arch"><p>Vous avez le même rôle aujourd'hui : mood partagé, sans tâche. Juste pour se dire où on en est.</p></div>
      </>
    )

  if (l.status === 'tache')
    return giver ? (
      <>
        {moodCard}
        <div className="card">
          <p className="kicker">Tâche à exécuter</p>
          <TextBox placeholder="Écris la tâche, adaptée à ce mood" max={1000} cta="Envoyer la tâche" rows={4} onSend={(text) => act({ type: 'task', req: l.req.id, text })} />
        </div>
      </>
    ) : (
      <>
        {moodCard}
        <div className="card arch"><p>Ton mood est parti. {them} prépare ta tâche…</p></div>
      </>
    )

  const taskCard = l.task && (
    <div className="card task">
      <p className="kicker">{giver ? `Tâche donnée à ${them}` : `Ta tâche, de la part de ${them}`}</p>
      <p className="q">{l.task.text}</p>
    </div>
  )

  if (l.status === 'encours') {
    if (giver)
      return (
        <>
          {taskCard}
          <div className="card arch"><p>{them} a jusqu'à minuit pour la réaliser.</p></div>
        </>
      )
    if (!doing)
      return (
        <>
          {taskCard}
          <p className="hint">À réaliser avant minuit, sinon un token punition tombe.</p>
          <button className="btn" onClick={() => setDoing(true)}>Fait</button>
        </>
      )
    return (
      <>
        {taskCard}
        <div className="card stack-in">
          <p className="kicker">Ton ressenti (seul·e {them} le verra)</p>
          <Slider label="La tâche m'a plu" value={fb.plu} onChange={(plu) => setFb({ ...fb, plu })} />
          <Slider label="Comment je me suis senti·e en la faisant" value={fb.pendant} onChange={(pendant) => setFb({ ...fb, pendant })} />
          <Slider label="Comment je me sens après" value={fb.apres} onChange={(apres) => setFb({ ...fb, apres })} />
          <textarea className="input" rows={3} maxLength={1000} placeholder="Commentaire (obligatoire)" value={fb.comment} onChange={(e) => setFb({ ...fb, comment: e.target.value })} />
          <button className="btn" disabled={!fb.comment.trim()} onClick={() => act({ type: 'done', req: l.req.id, ...fb, comment: fb.comment.trim() })}>
            Valider et envoyer
          </button>
        </div>
      </>
    )
  }

  // fait / nonrealisee / safeword
  return (
    <>
      {taskCard}
      <div className="card arch">
        {l.status === 'fait' ? (
          giver && l.done ? (
            <>
              <p className="script">Accomplie</p>
              <p>Plu {l.done.plu}/4 · Pendant {l.done.pendant}/4 · Après {l.done.apres}/4</p>
              <p>« {l.done.comment} »</p>
            </>
          ) : (
            <p>Tâche accomplie. Ton ressenti est parti chez {them}.</p>
          )
        ) : l.status === 'safeword' ? (
          <p>Safeword prononcé.</p>
        ) : (
          <p>Non réalisée.</p>
        )}
      </div>
    </>
  )
}

/* ---------- Contrat ---------- */

const ARTICLES = Array.from({ length: 7 }, (_, i) => `Article ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i]}`)

export function Contract({ ctx }: { ctx: Ctx }) {
  const { state, role, partnerRole, act } = ctx
  const partner = state.partner!
  const sigs = signatures(state.events)
  const mine = sigs.find((s) => s.by === state.me.id)
  const theirs = sigs.find((s) => s.by === partner.id)

  return (
    <div className="parchment">
      <div className="seal"><Logo size={44} /></div>
      {ARTICLES.map((a) => (
        <p key={a} className="fake" aria-hidden>
          <strong>{a}.</strong> Les parties conviennent par les présentes de se livrer l'une à l'autre selon les termes et usages consentis entre elles.
        </p>
      ))}
      <p className="conclusion">{contractLine(state.profile.pseudo, partner.pseudo, role, partnerRole)}</p>
      <div className="sigs">
        <Signature label={state.profile.pseudo} sig={mine} />
        <Signature label={partner.pseudo} sig={theirs} />
      </div>
      {!mine && <SignPad onDone={(path) => act({ type: 'sign', path })} />}
    </div>
  )
}

function Signature({ label, sig }: { label: string; sig?: Extract<Ev, { type: 'sign' }> }) {
  return (
    <figure>
      {sig ? (
        <svg viewBox="0 0 300 120"><path d={sig.path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <div className="unsigned">en attente</div>
      )}
      <figcaption>
        {label}
        {sig && ` · ${new Date(sig.day + 'T12:00').toLocaleDateString('fr-FR')}`}
      </figcaption>
    </figure>
  )
}

// Finger signature, stored as a small SVG path (fits in a link).
function SignPad({ onDone }: { onDone: (path: string) => void }) {
  const [path, setPath] = useState('')
  const drawing = useRef(false)
  const point = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return `${Math.round(((e.clientX - r.left) / r.width) * 300)} ${Math.round(((e.clientY - r.top) / r.height) * 120)}`
  }
  return (
    <div className="stack-in">
      <p className="kicker">Signe au doigt</p>
      <svg
        className="pad"
        viewBox="0 0 300 120"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          const at = point(e)
          setPath((p) => `${p}M${at}`)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const at = point(e)
          setPath((p) => `${p}L${at}`)
        }}
        onPointerUp={() => (drawing.current = false)}
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="row">
        <button className="ghost" onClick={() => setPath('')}>Effacer</button>
        <button className="btn" disabled={path.length < 20} onClick={() => onDone(path)}>Signer pour toujours</button>
      </div>
    </div>
  )
}

/* ---------- Historique ---------- */

export function History({ ctx }: { ctx: Ctx }) {
  const { state, today, act } = ctx
  const partner = state.partner!
  const [best, setBest] = useState(false)
  const all = loops(state.events, today)
  const score = (l: Loop) => (l.done ? l.done.plu + l.done.pendant + l.done.apres : -1)
  const given = all
    .filter((l) => l.req.by === state.me.id && (l.task || l.status === 'safeword'))
    .sort((a, b) => (best ? score(b) - score(a) : b.req.day.localeCompare(a.req.day)))
  const received = all.filter((l) => l.req.by !== state.me.id && l.task).sort((a, b) => b.req.day.localeCompare(a.req.day))
  const owed = tokens(state.events, partner.id, today)
  const days = [...new Set(state.events.filter((e) => (e.type === 'answer' || e.type === 'chat') && e.day < today).map((e) => e.day))].sort().reverse()

  return (
    <div className="stack wide-stack">
      {owed > 0 && (
        <div className="card row">
          <span>{partner.pseudo} doit <strong>{owed}</strong> token{owed > 1 ? 's' : ''}.</span>
          <button className="ghost small" onClick={() => act({ type: 'tokenUse' })}>Décompter un token</button>
        </div>
      )}

      {given.length > 0 && (
        <div className="card">
          <div className="row">
            <p className="kicker">Tâches données</p>
            <button className="ghost small" onClick={() => setBest(!best)}>{best ? 'Par date' : 'Les mieux notées'}</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Mood</th><th>Tâche</th><th>Plu</th><th>Pendant</th><th>Après</th><th>Commentaire</th></tr>
              </thead>
              <tbody>
                {given.map((l) => (
                  <tr key={l.req.id}>
                    <td>{new Date(l.req.day + 'T12:00').toLocaleDateString('fr-FR')}</td>
                    <td>{l.mood ? `${l.mood.envie} / ${l.mood.temps}` : '–'}</td>
                    <td>{l.task?.text ?? '–'}</td>
                    {l.done ? (
                      <>
                        <td>{l.done.plu}</td><td>{l.done.pendant}</td><td>{l.done.apres}</td><td>{l.done.comment}</td>
                      </>
                    ) : (
                      <td colSpan={4} className="status">{l.status === 'safeword' ? 'Safeword' : l.status === 'nonrealisee' ? 'Non réalisée' : 'En cours'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {received.length > 0 && (
        <div className="card">
          <p className="kicker">Tâches reçues</p>
          {received.map((l) => (
            <p key={l.req.id}>
              <span className="muted">{new Date(l.req.day + 'T12:00').toLocaleDateString('fr-FR')} · {moodLine(l)} ·</span> {l.task!.text}{' '}
              <em>({l.status === 'fait' ? 'faite' : l.status === 'safeword' ? 'safeword' : l.status === 'nonrealisee' ? 'non réalisée' : 'en cours'})</em>
            </p>
          ))}
        </div>
      )}

      {days.map((day) => {
        const ev = state.events.filter((e) => e.day === day)
        const answer = (by: string) => ev.find((e) => e.type === 'answer' && e.by === by)
        const a = answer(state.me.id), b = answer(partner.id)
        return (
          <details key={day} className="card">
            <summary>
              <span className="kicker">{fmtDay(day)}</span>
              <span className="q small">{questionOfDay(state.events, seedOf(ctx), day, QUESTIONS).text}</span>
            </summary>
            <p><strong>Toi :</strong> {a && 'text' in a ? a.text : '–'}</p>
            <p><strong>{partner.pseudo} :</strong> {b && 'text' in b ? b.text : '–'}</p>
            {ev.filter((e) => e.type === 'chat').sort(byAt).map((m) => (
              <p key={m.id} className={m.by === state.me.id ? 'bubble me' : 'bubble'}>{'text' in m && m.text}</p>
            ))}
          </details>
        )
      })}

      {!given.length && !received.length && !days.length && <div className="card arch"><p>Rien encore. L'histoire commence aujourd'hui.</p></div>}
    </div>
  )
}
