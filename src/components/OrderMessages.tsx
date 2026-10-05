import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { loadOrderMessages, sendOrderMessage, type OrderMessage } from '../lib/commerceApi'

type Props = {
  user: User
  orderId: string
  isAdmin?: boolean
  initialMessage?: string
  onIncomingMessage?: (orderId: string, message: OrderMessage) => void
}

export function OrderMessages({
  user,
  orderId,
  isAdmin = false,
  initialMessage = '',
  onIncomingMessage,
}: Props) {
  const [messages, setMessages] = useState<OrderMessage[]>([])
  const [draft, setDraft] = useState(initialMessage)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const shouldFollowMessages = useRef(true)

  useEffect(() => {
    let active = true
    let timeout: number | undefined
    let initialized = false
    const knownMessageIds = new Set<string>()
    const refresh = async () => {
      try {
        const nextMessages = await loadOrderMessages(user, orderId)
        if (!active) return
        if (initialized) {
          for (const message of nextMessages) {
            if (!knownMessageIds.has(message.id) && message.authorRole === 'admin' && !isAdmin) {
              onIncomingMessage?.(orderId, message)
            }
          }
        } else {
          initialized = true
        }
        nextMessages.forEach((message) => knownMessageIds.add(message.id))
        if (knownMessageIds.size > 300) {
          const currentIds = new Set(nextMessages.map((message) => message.id))
          knownMessageIds.clear()
          currentIds.forEach((id) => knownMessageIds.add(id))
        }
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
  }, [isAdmin, onIncomingMessage, orderId, user])

  useEffect(() => {
    if (shouldFollowMessages.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    shouldFollowMessages.current = true
    setError('')
    try {
      await sendOrderMessage(user, orderId, body)
      setDraft((current) => current === body ? '' : current)
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
          <h2>Chat con el equipo de Lúmina</h2>
          <p>Escribile al equipo de Lúmina sobre esta compra.</p>
        </div>
        <span className="order-chat-presence"><i aria-hidden="true" /> Equipo Lúmina</span>
      </div>
      <div
        ref={listRef}
        className="order-message-list"
        aria-label="Conversación de esta compra"
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget
          shouldFollowMessages.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 48
        }}
      >
        {loading ? (
          <p className="order-loading">Cargando mensajes…</p>
        ) : messages.length ? (
          messages.map((message) => (
            <article
              className={`order-message-bubble ${message.authorRole === (isAdmin ? 'admin' : 'customer') ? 'is-mine' : ''}`}
              key={message.id}
            >
              <div>
                <strong>{message.authorRole === 'admin' ? 'Equipo Lúmina' : message.authorName}</strong>
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
          <small>{draft.length}/2000 · Respondemos por este chat</small>
          <button type="submit" disabled={sending || !draft.trim()}>
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </section>
  )
}
