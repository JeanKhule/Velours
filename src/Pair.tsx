import { useEffect, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import jsQR from 'jsqr'
import { b64u, safetyCode } from './envelope'
import type { Partner, State } from './vault'

// Face to face: each phone shows its public key as a QR and scans the other's.
// Nothing goes through a network; the shared key is derived on each phone.
type Card = { id: string; pseudo: string; pub: string }

const encode = (c: Card) => 'BM1.' + b64u.enc(new TextEncoder().encode(JSON.stringify(c)))

function decode(text: string): Card | null {
  try {
    const c = JSON.parse(new TextDecoder().decode(b64u.dec(text.trim().replace(/^BM1\./, ''))))
    return typeof c.id === 'string' && typeof c.pub === 'string' && typeof c.pseudo === 'string' ? c : null
  } catch {
    return null
  }
}

export function Pair({ state, onPaired, onCancel }: { state: State; onPaired: (p: Partner) => void; onCancel: () => void }) {
  const mine = encode({ id: state.me.id, pseudo: state.profile.pseudo, pub: state.me.pub })
  const [scanning, setScanning] = useState(false)
  const [manual, setManual] = useState('')
  const [found, setFound] = useState<Card | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')


  const take = async (text: string) => {
    const c = decode(text)
    if (!c || c.id === state.me.id) return setError("Ce code n'est pas celui d'un téléphone BM.")
    setError('')
    setScanning(false)
    setFound(c)
    setCode(await safetyCode(state.me.pub, c.pub))
  }

  if (found)
    return (
      <main className="screen">
        <h1>Vérifiez ensemble</h1>
        <p className="lead">Le même code doit s'afficher sur les deux téléphones.</p>
        <p className="safety">{code}</p>
        <p className="lead">
          Si ce n'est pas déjà fait, <strong>{found.pseudo}</strong> scanne maintenant ton QR :
        </p>
        <MyQr state={state} />
        <div className="stack">
          <button className="btn" onClick={() => onPaired({ ...found, pairedAt: new Date().toISOString() })}>
            C'est le même : lier avec {found.pseudo}
          </button>
          <button className="ghost wide" onClick={() => setFound(null)}>Ce n'est pas le même</button>
        </div>
      </main>
    )

  return (
    <main className="screen">
      <h1>Appairage</h1>
      <p className="lead">Face à face : chacun scanne le QR de l'autre.</p>
      {scanning ? (
        <Scanner onText={take} onError={setError} />
      ) : (
        <MyQr state={state} />
      )}
      <div className="stack">
        <button className="btn" onClick={() => setScanning(!scanning)}>{scanning ? 'Afficher mon QR' : 'Scanner son QR'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        <details className="manual">
          <summary>Pas de caméra ?</summary>
          <p className="hint left">Ton code : à recopier sur l'autre téléphone, en face à face uniquement.</p>
          <textarea className="input" rows={3} readOnly value={mine} onFocus={(e) => e.target.select()} />
          <textarea className="input" rows={3} placeholder="Colle son code ici" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="ghost wide" disabled={!manual} onClick={() => take(manual)}>Valider son code</button>
        </details>
        <button className="ghost wide" onClick={onCancel}>Retour</button>
      </div>
    </main>
  )
}

// This phone's pairing QR; also reachable from settings once linked, so the other phone can still scan it.
export function MyQr({ state }: { state: State }) {
  const qr = qrcode(0, 'M')
  qr.addData(encode({ id: state.me.id, pseudo: state.profile.pseudo, pub: state.me.pub }))
  qr.make()
  return <div className="qr" aria-label="Ton QR d'appairage" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ scalable: true, margin: 2 }) }} />
}

function Scanner({ onText, onError }: { onText: (t: string) => void; onError: (e: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    let stream: MediaStream | undefined
    let frame = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const tick = () => {
      const v = video.current
      if (v && v.readyState >= 2) {
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        ctx.drawImage(v, 0, 0)
        const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
        if (hit?.data) return onText(hit.data)
      }
      frame = requestAnimationFrame(tick)
    }
    if (!navigator.mediaDevices) {
      onError('Caméra indisponible ici (il faut une adresse https). Utilise « Pas de caméra ? ».')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        video.current!.srcObject = s
        frame = requestAnimationFrame(tick)
      })
      .catch(() => onError("Caméra indisponible. Utilise « Pas de caméra ? »."))
    return () => {
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  return <video ref={video} className="qr" autoPlay playsInline muted />
}
