import type { User } from 'firebase/auth'

async function postEmailRequest(
  endpoint: string,
  payload: Record<string, string>,
  token?: string,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error(
      response.ok
        ? 'El servidor devolvió una respuesta no válida.'
        : 'No pudimos conectar con el servicio de correo. Asegurate de iniciar npm run dev:full.',
    )
  }
  const message =
    typeof result === 'object' && result !== null && 'message' in result
      ? String(result.message)
      : typeof result === 'object' && result !== null && 'error' in result
        ? String(result.error)
        : ''

  if (!response.ok) {
    throw new Error(message || 'No pudimos enviar el correo. Intentá de nuevo más tarde.')
  }

  return message || 'Listo. Revisá tu correo.'
}

export async function requestVerificationEmail(user: User): Promise<string> {
  const token = await user.getIdToken()
  return postEmailRequest('/api/email/verification', {}, token)
}

export function requestPasswordResetEmail(email: string): Promise<string> {
  return postEmailRequest('/api/email/password-reset', { email })
}
