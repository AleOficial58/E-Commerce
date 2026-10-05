import type { CustomerOrderSummary } from '../lib/commerceApi'
import { ThemeToggleButton } from '../lib/theme'

type Props = {
  orders: CustomerOrderSummary[]
  loading: boolean
  error: string
  money: Intl.NumberFormat
  onBack: () => void
  onRefresh: () => void
  onOpenOrder: (orderId: string) => void
}

function getStatusLabel(order: CustomerOrderSummary): string {
  if (order.status === 'cancellation_refund_pending') return 'Reembolso en proceso'
  if (order.status === 'cancelled' || order.paymentStatus === 'refunded') return 'Compra cancelada'
  if (order.paymentStatus !== 'approved') {
    if (order.status === 'payment_review') return 'En revisión'
    if (order.status === 'payment_failed') return 'Pago no completado'
    if (order.status === 'payment_expired') return 'Pago vencido'
    return 'Pago pendiente'
  }
  if (order.status === 'preparing') return 'En preparación'
  if (order.status === 'shipped') return 'Enviado'
  if (order.status === 'delivered') return 'Entregado'
  return 'Compra confirmada'
}

export function CustomerOrdersPage({
  orders,
  loading,
  error,
  money,
  onBack,
  onRefresh,
  onOpenOrder,
}: Props) {
  return (
    <main className="customer-orders-page">
      <header className="order-page-header">
        <button className="order-page-brand" type="button" onClick={onBack} aria-label="Volver a la tienda">
          lúmina<span aria-hidden="true">✳</span>
        </button>
        <div className="order-page-header-actions">
          <span>Tu espacio Lúmina</span>
          <ThemeToggleButton />
        </div>
      </header>
      <div className="customer-orders-content">
        <button className="customer-orders-back" type="button" onClick={onBack}>← Volver a la tienda</button>
        <div className="customer-orders-heading">
          <div>
            <span className="eyebrow section-eyebrow">TU CUENTA</span>
            <h1>Mis compras</h1>
            <p>Consultá tus pedidos y seguí cada etapa de la entrega.</p>
          </div>
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Actualizando…' : 'Actualizar compras'}
          </button>
        </div>
        {error ? (
          <section className="customer-orders-empty" role="alert">
            <h2>No pudimos cargar tus compras</h2>
            <p>{error}</p>
            <button type="button" onClick={onRefresh}>Volver a intentar</button>
          </section>
        ) : loading && orders.length === 0 ? (
          <section className="customer-orders-empty" role="status">
            <span className="sync-indicator" aria-hidden="true" />
            <p>Estamos cargando tus compras…</p>
          </section>
        ) : orders.length ? (
          <div className="customer-orders-list">
            {orders.map((order) => (
              <button
                className="customer-order-card"
                key={order.id}
                type="button"
                onClick={() => onOpenOrder(order.id)}
              >
                <div className="customer-order-card-header">
                  <div>
                    <span className="customer-order-date">
                      {order.createdAt
                        ? new Intl.DateTimeFormat('es-AR', {
                            dateStyle: 'long',
                            timeStyle: 'short',
                          }).format(new Date(order.createdAt))
                        : 'Fecha no disponible'}
                    </span>
                    <strong>Pedido {order.id.slice(0, 8).toLocaleUpperCase('es-AR')}</strong>
                  </div>
                  <span className={`account-order-status status-${order.status}`}>
                    {getStatusLabel(order)}
                  </span>
                </div>
                {order.shipmentType && order.estimatedDeliveryStart && order.estimatedDeliveryEnd && (
                  <p className="customer-order-eta">
                    Llega entre el{' '}
                    {new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' })
                      .format(new Date(`${order.estimatedDeliveryStart}T12:00:00`))}
                    {' y el '}
                    {new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' })
                      .format(new Date(`${order.estimatedDeliveryEnd}T12:00:00`))}
                  </p>
                )}
                <div className="customer-order-card-body">
                  <div className="customer-order-images">
                    {order.items.slice(0, 4).map((item, index) => (
                      <img src={item.image} alt={item.name} key={`${item.name}-${index}`} />
                    ))}
                    {order.items.length > 4 && <span>+{order.items.length - 4}</span>}
                  </div>
                  <div className="customer-order-description">
                    <p>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}</p>
                    <strong>{money.format(order.total)}</strong>
                  </div>
                  <span className="customer-order-chevron" aria-hidden="true">›</span>
                </div>
                <span className="customer-order-detail-link">Ver detalle y seguimiento →</span>
              </button>
            ))}
          </div>
        ) : (
          <section className="customer-orders-empty">
            <span className="customer-orders-empty-mark" aria-hidden="true">✳</span>
            <h2>Todavía no tenés compras</h2>
            <p>Cuando completes una compra, vas a poder consultarla y seguir su entrega desde acá.</p>
            <button type="button" onClick={onBack}>Explorar la tienda</button>
          </section>
        )}
      </div>
    </main>
  )
}
