import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StoreNotification } from '../lib/notificationStore'
import './NotificationCenter.css'

type NotificationCenterProps = {
  notifications: StoreNotification[]
  loading: boolean
  soundEnabled: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onClear: () => void
  onSoundChange: (enabled: boolean) => void
  onOpenOrder: (orderId: string) => void
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function NotificationCenter({
  notifications,
  loading,
  soundEnabled,
  onMarkRead,
  onMarkAllRead,
  onClear,
  onSoundChange,
  onOpenOrder,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const unreadCount = notifications.reduce((count, item) => count + Number(!item.read), 0)
  const shownNotifications = useMemo(
    () => unreadOnly ? notifications.filter((item) => !item.read) : notifications,
    [notifications, unreadOnly],
  )

  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const updateViewport = () => setIsMobile(media.matches)
    media.addEventListener('change', updateViewport)
    return () => media.removeEventListener('change', updateViewport)
  }, [])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (event.key !== 'Tab' || !isMobile || !panelRef.current) return
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled])',
      ))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isMobile, open])

  function closeAndRestoreFocus() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function openNotification(notification: StoreNotification) {
    onMarkRead(notification.id)
    closeAndRestoreFocus()
    onOpenOrder(notification.orderId)
  }

  const panel = (
    <div className="notification-backdrop">
      <section
        ref={panelRef}
        id="notification-panel"
        className="notification-panel"
        role="dialog"
        aria-label="Centro de notificaciones"
        aria-modal={isMobile || undefined}
      >
        <header className="notification-panel-header">
          <div>
            <span className="notification-overline">TU ESPACIO LÚMINA</span>
            <h2>Notificaciones <span>{unreadCount || '·'}</span></h2>
          </div>
          <button
            ref={closeRef}
            className="notification-close"
            type="button"
            aria-label="Cerrar notificaciones"
            onClick={closeAndRestoreFocus}
          >×</button>
        </header>

        <div className="notification-toolbar">
          <div className="notification-filters" role="group" aria-label="Filtrar notificaciones">
            <button type="button" className={!unreadOnly ? 'is-active' : ''} aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Todas</button>
            <button type="button" className={unreadOnly ? 'is-active' : ''} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Sin leer{unreadCount ? ` · ${unreadCount}` : ''}</button>
          </div>
          <button
            className="notification-preferences-link"
            type="button"
            onClick={() => setPreferencesOpen((current) => !current)}
            aria-expanded={preferencesOpen}
          >{preferencesOpen ? 'Volver' : 'Preferencias'}</button>
        </div>

        {preferencesOpen ? (
          <div className="notification-preferences">
            <span className="notification-preferences-icon" aria-hidden="true">♪</span>
            <div>
              <strong>Sonido de notificaciones</strong>
              <p>Un tono breve cuando detectemos una novedad nueva en esta tienda.</p>
            </div>
            <button
              type="button"
              className={`notification-switch${soundEnabled ? ' is-on' : ''}`}
              role="switch"
              aria-checked={soundEnabled}
              aria-label="Activar sonido de notificaciones"
              onClick={() => onSoundChange(!soundEnabled)}
            ><span /></button>
            <small>Desactivado por defecto. El sonido solo se reproduce mientras esta página está abierta.</small>
          </div>
        ) : (
          <>
            {unreadCount > 0 && (
              <button className="notification-mark-all" type="button" onClick={onMarkAllRead}>Marcar todas como leídas</button>
            )}
            <div className="notification-list" aria-live="polite" aria-busy={loading}>
              {loading ? (
                <div className="notification-loading" role="status">
                  <span /><span /><span />
                  <p>Cargando tus notificaciones…</p>
                </div>
              ) : shownNotifications.length ? (
                shownNotifications.map((notification) => (
                  <button
                    className={`notification-item${notification.read ? '' : ' is-unread'}`}
                    type="button"
                    key={notification.id}
                    onClick={() => openNotification(notification)}
                  >
                    <span className={`notification-item-icon is-${notification.kind}`} aria-hidden="true">
                      {notification.kind === 'message' ? '···' : '↗'}
                    </span>
                    <span className="notification-item-copy">
                      <span className="notification-item-heading">
                        <strong>{notification.title}</strong>
                        {!notification.read && <i aria-label="Sin leer" />}
                      </span>
                      <span className="notification-item-message">{notification.message}</span>
                      <time dateTime={notification.createdAt}>{formatDate(notification.createdAt)}</time>
                    </span>
                  </button>
                ))
              ) : (
                <div className="notification-empty">
                  <span aria-hidden="true">✳</span>
                  <strong>{unreadOnly ? 'Todo al día' : 'Todavía no hay novedades'}</strong>
                  <p>{unreadOnly ? 'No tenés notificaciones sin leer.' : 'Acá vas a encontrar novedades reales sobre tus compras y mensajes.'}</p>
                </div>
              )}
            </div>
            {!!notifications.length && !loading && (
              <footer className="notification-panel-footer">
                <span>Guardamos las últimas 50 novedades en este dispositivo.</span>
                <button type="button" onClick={onClear}>Borrar todo</button>
              </footer>
            )}
          </>
        )}
      </section>
    </div>
  )

  return (
    <div className="notification-center" ref={rootRef}>
      <button
        ref={triggerRef}
        className="icon-button notification-trigger"
        type="button"
        aria-label={unreadCount ? `Notificaciones, ${unreadCount} sin leer` : 'Notificaciones'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notification-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (isMobile ? createPortal(panel, document.body) : panel)}
    </div>
  )
}
