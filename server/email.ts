import './env.js'
import nodemailer, { type Transporter } from 'nodemailer'

export type EmailKind = 'verifyEmail' | 'resetPassword'

const appUrl = new URL(process.env.PUBLIC_APP_URL ?? 'http://localhost:5173')
const smtpPort = Number(process.env.SMTP_PORT ?? 587)
const smtpConfigured = Boolean(
  process.env.SMTP_HOST &&
    Number.isInteger(smtpPort) &&
    smtpPort > 0 &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.SMTP_FROM,
)

let transporter: Transporter | null = null

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character] ?? character
  })
}

function getTransporter(): Transporter {
  if (!smtpConfigured) {
    throw new Error('El servicio de correo SMTP no está configurado.')
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    })
  }
  return transporter
}

function createActionUrl(mode: EmailKind, generatedLink: string): string {
  let candidate = generatedLink

  for (let depth = 0; depth < 3; depth += 1) {
    const link = new URL(candidate)
    const actionCode = link.searchParams.get('oobCode')
    if (actionCode) {
      const actionUrl = new URL('/auth/action', appUrl)
      actionUrl.searchParams.set('mode', mode)
      actionUrl.searchParams.set('oobCode', actionCode)
      return actionUrl.toString()
    }

    const nestedLink =
      link.searchParams.get('link') ?? link.searchParams.get('deep_link_id')
    if (!nestedLink) break
    candidate = nestedLink
  }

  throw new Error('Firebase no devolvió un código de acción válido.')
}

function getEmailContent(kind: EmailKind, actionUrl: string, displayName?: string) {
  const name = displayName?.trim() ?? ''
  const safeName = escapeHtml(name)
  const isVerification = kind === 'verifyEmail'
  const title = isVerification ? 'Un detalle para confirmar tu cuenta' : 'Volvé a entrar a tu espacio'
  const intro = isVerification
    ? 'Gracias por sumarte a Lúmina. Confirmá tu dirección de correo para que podamos dejar tu cuenta lista.'
    : 'Recibimos una solicitud para cambiar la contraseña de tu cuenta Lúmina.'
  const buttonLabel = isVerification ? 'Verificar mi email' : 'Crear contraseña nueva'
  const expiry = isVerification
    ? 'Si no creaste una cuenta en Lúmina, podés ignorar este correo.'
    : 'Si no pediste cambiar la contraseña, ignorá este correo. Tu contraseña actual seguirá siendo la misma.'
  const text = [
    name ? `Hola ${name},` : 'Hola,',
    '',
    intro,
    '',
    `${buttonLabel}: ${actionUrl}`,
    '',
    expiry,
    '',
    'Con cariño,',
    'El equipo de Lúmina',
  ].join('\n')
  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#fffaf7;font-family:Arial,Helvetica,sans-serif;color:#302a30">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fffaf7;padding:36px 14px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffdfb;border:1px solid #f0e5e0">
          <tr><td align="center" style="padding:32px 24px 22px">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:700;letter-spacing:-2px;color:#302a30">lúmina<span style="color:#d8899e;font-size:15px;vertical-align:top">✳</span></div>
            <div style="margin-top:13px;font-size:9px;font-weight:700;letter-spacing:2px;color:#9f777f">UN DETALLE, TODO TU ESTILO</div>
          </td></tr>
          <tr><td style="padding:8px 36px 38px;text-align:center">
            <div style="width:54px;height:54px;margin:0 auto 20px;border-radius:50%;background:#f5e1e2;color:#9c6476;font-size:25px;line-height:54px">✳</div>
            <h1 style="margin:0 0 14px;font-size:25px;line-height:1.25;font-weight:600;letter-spacing:-1px;color:#352d33">${title}</h1>
            <p style="margin:0 auto 26px;max-width:410px;font-size:14px;line-height:1.75;color:#80767a">${name ? `Hola ${safeName}, ` : ''}${intro}</p>
            <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:15px 24px;background:#342b32;color:#fffdfb;text-decoration:none;font-size:13px;font-weight:600">${buttonLabel} &nbsp; →</a>
            <p style="margin:24px auto 0;max-width:410px;font-size:11px;line-height:1.7;color:#958b8e">${expiry}</p>
            <p style="margin:25px 0 0;font-size:12px;line-height:1.7;color:#655960">Con cariño,<br><strong>El equipo de Lúmina</strong></p>
          </td></tr>
          <tr><td align="center" style="padding:15px 20px;border-top:1px solid #f0e5e0;font-size:10px;color:#9a8e92">Hecho para brillar <span style="color:#d58e9e">✳</span></td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  return {
    subject: isVerification ? 'Verificá tu email | Lúmina' : 'Restablecé tu contraseña | Lúmina',
    text,
    html,
  }
}

export function isEmailConfigured(): boolean {
  return smtpConfigured
}

export async function sendActionEmail(
  kind: EmailKind,
  generatedLink: string,
  email: string,
  displayName?: string,
): Promise<void> {
  const actionUrl = createActionUrl(kind, generatedLink)
  const content = getEmailContent(kind, actionUrl, displayName)
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: content.subject,
    text: content.text,
    html: content.html,
  })
}

export function getActionCodeSettings() {
  return {
    url: appUrl.toString(),
    handleCodeInApp: false,
  }
}
