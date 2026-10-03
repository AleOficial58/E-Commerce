import { useEffect, useState, type FormEvent } from 'react'
import { firebaseReady, getFirebaseServices } from '../lib/firebase'
import './AuthActionPage.css'

type ActionStatus = 'loading' | 'ready' | 'success' | 'error'
const actionRequests = new Map<string, Promise<string | null>>()

function getActionErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : ''
  const messages: Record<string, string> = {
    'auth/expired-action-code': 'Este enlace venció. Volvé a solicitar uno nuevo desde Lúmina.',
    'auth/invalid-action-code': 'Este enlace ya se usó o no es válido. Solicitá uno nuevo desde Lúmina.',
    'auth/invalid-email': 'El enlace no contiene una dirección de email válida.',
    'auth/network-request-failed': 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.',
    'auth/too-many-requests': 'Hubo muchos intentos. Esperá un momento y volvé a probar.',
    'auth/user-disabled': 'Esta cuenta está deshabilitada. Contactá con soporte.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  }
  return messages[code] ?? 'No pudimos completar esta acción. Solicitá un nuevo enlace desde Lúmina.'
}

function ActionBrand() {
  return (
    <a className="action-wordmark" href="/" aria-label="Lúmina, inicio">
      lúmina<span>✳</span>
    </a>
  )
}

export function AuthActionPage({
  mode,
  actionCode,
  preview = false,
}: {
  mode: string | null
  actionCode: string | null
  preview?: boolean
}) {
  const validMode = mode === 'verifyEmail' || mode === 'resetPassword'
  const [status, setStatus] = useState<ActionStatus>(
    preview && mode === 'resetPassword'
      ? 'ready'
      : preview && mode === 'verifyEmail'
        ? 'success'
        : validMode && actionCode && firebaseReady
          ? 'loading'
          : 'error',
  )
  const [email, setEmail] = useState(preview ? 'ale@ejemplo.com' : '')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [errorMessage, setErrorMessage] = useState(
    preview
      ? ''
      : !firebaseReady
      ? 'No pudimos conectar con Firebase. Volvé a abrir el enlace cuando la tienda esté disponible.'
      : !validMode || !actionCode
        ? 'El enlace está incompleto o no corresponde a una acción reconocida.'
        : '',
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (preview) return
    if (!validMode || !actionCode || !firebaseReady) return
    let active = true

    const requestKey = `${mode}:${actionCode}`
    let actionRequest = actionRequests.get(requestKey)
    if (!actionRequest) {
      actionRequest = getFirebaseServices().then(async ({ auth, authSdk }) => {
        if (mode === 'verifyEmail') {
          await authSdk.applyActionCode(auth, actionCode)
          return null
        }
        return authSdk.verifyPasswordResetCode(auth, actionCode)
      })
      actionRequests.set(requestKey, actionRequest)
    }

    void actionRequest
      .then((address) => {
        if (!active) return
        if (mode === 'verifyEmail') {
          setStatus('success')
          return
        }
        setEmail(address ?? '')
        setStatus('ready')
      })
      .catch((error: unknown) => {
        console.error('No se pudo validar el enlace de acción de Firebase.', error)
        if (active) {
          setErrorMessage(getActionErrorMessage(error))
          setStatus('error')
        }
      })

    return () => {
      active = false
    }
  }, [actionCode, mode, preview, validMode])

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    if (preview) {
      setErrorMessage('Esto es solo una vista previa. No se cambió ninguna contraseña.')
      return
    }

    if (password.length < 6) {
      setErrorMessage('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (password !== passwordConfirmation) {
      setErrorMessage('Las contraseñas no coinciden.')
      return
    }
    if (!actionCode) {
      setErrorMessage('Falta el código de recuperación. Solicitá un enlace nuevo.')
      setStatus('error')
      return
    }

    setBusy(true)
    try {
      const { auth, authSdk } = await getFirebaseServices()
      await authSdk.confirmPasswordReset(auth, actionCode, password)
      setPassword('')
      setPasswordConfirmation('')
      setStatus('success')
    } catch (error) {
      console.error('No se pudo cambiar la contraseña desde el enlace de Firebase.', error)
      setErrorMessage(getActionErrorMessage(error))
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['auth/expired-action-code', 'auth/invalid-action-code'].includes(String(error.code))
      ) {
        setStatus('error')
      }
    } finally {
      setBusy(false)
    }
  }

  const isVerification = mode === 'verifyEmail'
  const title =
    status === 'loading'
      ? 'Un momento…'
      : status === 'success'
        ? isVerification
          ? '¡Email verificado!'
          : '¡Contraseña actualizada!'
        : status === 'ready'
          ? 'Elegí una contraseña nueva'
          : 'No pudimos validar el enlace'

  return (
    <main className="auth-action-page">
      <header className="auth-action-header">
        <ActionBrand />
        <span>UN DETALLE, TODO TU ESTILO</span>
      </header>

      <section className="auth-action-card" aria-labelledby="action-title">
        {preview && <div className="auth-action-preview">VISTA PREVIA · NO SE ENVÍA NI MODIFICA NADA</div>}
        <span className={`auth-action-mark ${status === 'error' ? 'is-error' : ''}`}>
          {status === 'loading' ? '…' : status === 'success' ? '✓' : status === 'error' ? '!' : '✳'}
        </span>
        <span className="eyebrow">TU ESPACIO LÚMINA</span>
        <h1 id="action-title">{title}</h1>

        {status === 'loading' && (
          <p className="auth-action-description">Estamos validando tu enlace de forma segura.</p>
        )}

        {status === 'success' && (
          <>
            <p className="auth-action-description">
              {isVerification
                ? 'Tu dirección de correo ya está verificada. Gracias por ser parte de Lúmina.'
                : 'Tu contraseña se actualizó correctamente. Ya podés ingresar a tu cuenta.'}
            </p>
            <a className="button button-dark auth-action-button" href="/">
              Volver a Lúmina <span aria-hidden="true">→</span>
            </a>
          </>
        )}

        {status === 'error' && (
          <>
            <p className="auth-action-error" role="alert">{errorMessage}</p>
            <a className="button button-dark auth-action-button" href="/">
              Ir a Lúmina <span aria-hidden="true">→</span>
            </a>
            <p className="auth-action-help">
              Desde Mi cuenta podés solicitar un enlace nuevo.
            </p>
          </>
        )}

        {status === 'ready' && (
          <>
            <p className="auth-action-description">
              Creá una contraseña nueva para <strong>{email}</strong>.
            </p>
            <form className="auth-action-form" onSubmit={handlePasswordReset}>
              <label>
                Nueva contraseña
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Al menos 6 caracteres"
                  required
                />
              </label>
              <label>
                Repetí la contraseña
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  placeholder="Escribila otra vez"
                  required
                />
              </label>
              {errorMessage && <p className="auth-action-error" role="alert">{errorMessage}</p>}
              <button className="button button-dark auth-action-button" type="submit" disabled={busy || preview}>
                {preview ? 'Vista previa' : busy ? 'Guardando…' : 'Guardar contraseña'} <span aria-hidden="true">→</span>
              </button>
            </form>
          </>
        )}
      </section>

      <footer className="auth-action-footer">
        <span>Hecho para brillar <b>✳</b></span>
      </footer>
    </main>
  )
}
