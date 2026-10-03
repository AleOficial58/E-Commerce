import { useEffect, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { loadOrderMessages, sendOrderMessage, type OrderMessage } from '../lib/commerceApi'

type Props = {
  user: User
  orderId: string
  isAdmin?: boolean
  initialMessage?: string
}

export function OrderMessages({ user, orderId, isAdmin = false, initialMessage = '' }: Props) {
  const [messages, setMessages] = useState<OrderMessage[]>([])
  const [draft, setDraft] = useState(initialMessage)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let timeout: number | undefined
    const refresh = async () => {
      try {
        const nextMessages = await loadOrderMessages(user, orderId)
        if (!active) return
        setMessages(nextMessages)
        setError('')
        setLoading(false)
      } catch (loadError) {
        if (!active) return
        console.error('No se pudieron cargar los mensajes del pedido.', loadError)
        setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los mensajes.')
        setLoading(false)
      }
      if (active) timeout = window.setTimeout(() => void refresh(), 8000)
    }
    void refresh()
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [orderId, user])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      await sendOrderMessage(user, orderId, body)
      setDraft('')
      setMessages(await loadOrderMessages(user, orderId))
    } catch (sendError) {
      console.error('No se pudo enviar un mensaje del pedido.', sendError)
      setError(sendError instanceof Error ? sendError.message : 'No se pudo enviar el mensaje.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section id={`order-messages-${orderId}`} className={`order-page-card order-messages ${isAdmin ? 'is-admin-messages' : ''}`}>
      <div className="order-messages-heading">
        <div>
          <h2>Mensajes con el vendedor</h2>
          <p>Escribile al equipo de Lúmina sobre esta compra.</p>
        </div>
        <span aria-hidden="true">✳</span>
      </div>
      <div className="order-message-list" aria-live="polite">
        {loading ? (
          <p className="order-loading">Cargando mensajes…</p>
        ) : messages.length ? (
          messages.map((message) => (
            <article
              className={`order-message-bubble ${message.authorRole === (isAdmin ? 'admin' : 'customer') ? 'is-mine' : ''}`}
              key={message.id}
            >
              <div>
                <strong>{message.authorName}</strong>
                {message.createdAt && (
                  <time dateTime={message.createdAt}>
                    {new Intl.DateTimeFormat('es-AR', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(message.createdAt))}
                  </time>
                )}
              </div>
              <p>{message.body}</p>
            </article>
          ))
        ) : (
          <p className="order-message-empty">
            Todavía no hay mensajes. Escribinos desde acá y te responderemos en esta compra.
          </p>
        )}
      </div>
      {error && <p className="order-message-error" role="alert">{error}</p>}
      <form className="order-message-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="visually-hidden" htmlFor={`order-message-${orderId}`}>
          Escribí un mensaje sobre esta compra
        </label>
        <textarea
          id={`order-message-${orderId}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          placeholder="Escribí tu consulta…"
          rows={3}
          required
        />
        <div>
          <small>Máximo 2000 caracteres</small>
          <button type="submit" disabled={sending || !draft.trim()}>
            {sending ? 'Enviando…' : 'Enviar mensaje'}
          </button>
        </div>
      </form>
    </section>
  )
}
