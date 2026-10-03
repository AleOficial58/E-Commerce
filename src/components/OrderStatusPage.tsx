import type { CustomerOrderStatus } from '../lib/commerceApi'

type PaymentReturnStatus = 'checking' | 'approved' | 'pending' | 'failed' | 'review' | 'error'

type Props = {
  orderId: string
  order: CustomerOrderStatus | null
  status: PaymentReturnStatus
  message: string
  onRefresh: () => void
  onBack: () => void
  money: Intl.NumberFormat
}

const fulfillmentSteps = [
  { status: 'new', label: 'Compra confirmada' },
  { status: 'preparing', label: 'En preparación' },
  { status: 'shipped', label: 'Enviada' },
  { status: 'delivered', label: 'Entregada' },
]

function getStatusTitle(status: PaymentReturnStatus, order: CustomerOrderStatus | null): string {
  if (status === 'checking') return 'Estamos verificando tu compra'
  if (status === 'error') return 'No pudimos actualizar el estado'
  if (status === 'failed') return 'El pago no se completó'
  if (status === 'pending') return 'El pago está pendiente'
  if (status === 'review') return 'Tu compra está en revisión'
  if (order?.status === 'preparing') return 'Estamos preparando tu compra'
  if (order?.status === 'shipped') return 'Tu compra está en camino'
  if (order?.status === 'delivered') return 'Compra entregada'
  return '¡Compra exitosa!'
}

function getStatusMessage(status: PaymentReturnStatus, order: CustomerOrderStatus | null, message: string): string {
  if (status === 'checking') return 'Estamos consultando el estado confirmado por Mercado Pago.'
  if (status === 'error') return message || 'No pudimos consultar tu pedido. Podés volver a intentarlo.'
  if (status === 'failed') return 'Mercado Pago no confirmó el pago. El pedido no avanzará hasta que se complete.'
  if (status === 'pending') return 'Mercado Pago todavía no confirmó el pago. Actualizaremos el estado cuando recibamos la confirmación.'
  if (status === 'review') return 'El pago fue aprobado. Estamos revisando la disponibilidad antes de continuar con la preparación.'
  if (order?.status === 'preparing') return 'Tu pago está confirmado y estamos preparando los productos.'
  if (order?.status === 'shipped') return 'Tu pedido ya fue despachado. El estado se actualizará cuando esté entregado.'
  if (order?.status === 'delivered') return 'El pedido figura como entregado. ¡Gracias por comprar en Lúmina!'
  return 'Mercado Pago confirmó el pago y recibimos tu pedido.'
}

export function OrderStatusPage({
  orderId,
  order,
  status,
  message,
  onRefresh,
  onBack,
  money,
}: Props) {
  const activeStep = status === 'approved'
    ? fulfillmentSteps.findIndex((step) => step.status === order?.status)
    : -1
  const paymentLabel = order?.paymentStatus === 'approved'
    ? 'Pago acreditado'
    : status === 'failed'
      ? 'Pago no completado'
      : 'Esperando confirmación'
  const address = order?.shipping
  const formattedDate = order?.createdAt
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'long' }).format(new Date(order.createdAt))
    : null

  return (
    <main className="order-page">
      <header className="order-page-header">
        <button className="order-page-brand" type="button" onClick={onBack} aria-label="Volver a la tienda">
          lúmina<span aria-hidden="true">✳</span>
        </button>
        <span>Estado de tu compra</span>
      </header>
      <div className="order-page-content">
        <nav className="order-page-breadcrumb" aria-label="Navegación">
          <button type="button" onClick={onBack}>Tienda</button>
          <span aria-hidden="true">/</span>
          <span>Estado de la compra</span>
        </nav>

        <div className="order-page-grid">
          <div className="order-page-main">
            <section className={`order-status-card is-${status}`} aria-live="polite">
              <div className="order-status-heading">
                <span className="order-status-icon" aria-hidden="true">
                  {status === 'approved' ? '✓' : status === 'failed' || status === 'error' ? '!' : '…'}
                </span>
                <div>
                  <span className="eyebrow section-eyebrow">ESTADO DE TU COMPRA</span>
                  <h1>{getStatusTitle(status, order)}</h1>
                  <p>{getStatusMessage(status, order, message)}</p>
                </div>
              </div>

              {status === 'approved' && (
                <ol className="order-timeline" aria-label="Seguimiento del pedido">
                  {fulfillmentSteps.map((step, index) => (
                    <li
                      key={step.status}
                      className={index < activeStep ? 'is-complete' : index === activeStep ? 'is-current' : ''}
                    >
                      <span className="order-timeline-marker" aria-hidden="true">
                        {index < activeStep ? '✓' : ''}
                      </span>
                      <span>{step.label}</span>
                    </li>
                  ))}
                </ol>
              )}

              {status === 'review' && (
                <div className="order-status-note">Te avisaremos cuando el pedido esté listo para prepararse.</div>
              )}
              {status === 'pending' && (
                <div className="order-status-note">No vuelvas a pagar mientras Mercado Pago procesa la operación.</div>
              )}
              {status === 'failed' && (
                <div className="order-status-note">Si creés que hubo un error, consultá el estado nuevamente antes de iniciar otro pago.</div>
              )}
              {status === 'checking' && !order && (
                <div className="order-loading" role="status">Cargando los datos del pedido…</div>
              )}
              {status === 'error' && (
                <button className="button button-dark profile-save-button" type="button" onClick={onRefresh}>
                  Volver a consultar
                </button>
              )}
              {['pending', 'review'].includes(status) && (
                <button className="order-refresh-button" type="button" onClick={onRefresh}>
                  Actualizar estado
                </button>
              )}
            </section>

            <section className="order-page-card">
              <h2>Productos de tu compra</h2>
              {order ? (
                <div className="order-status-items">
                  {order.items.map((item) => (
                    <article className="order-status-item" key={item.id}>
                      <img src={item.image} alt="" />
                      <div>
                        <strong>{item.name}</strong>
                        <span>{item.quantity} {item.quantity === 1 ? 'unidad' : 'unidades'} · {money.format(item.price)} c/u</span>
                      </div>
                      <b>{money.format(item.lineTotal)}</b>
                    </article>
                  ))}
                  {order.items.length === 0 && <p className="order-empty-items">No hay productos disponibles para mostrar.</p>}
                </div>
              ) : (
                <p className="order-loading">Los productos aparecerán cuando podamos consultar el pedido.</p>
              )}
            </section>

            <section className="order-page-card">
              <h2>Información de entrega</h2>
              {address ? (
                <address className="order-shipping-address">
                  <strong>{address.name}</strong>
                  <span>{address.address}{address.apartment ? `, ${address.apartment}` : ''}</span>
                  <span>{address.city}, {address.province} {address.postalCode}</span>
                  <span>{address.phone}</span>
                </address>
              ) : (
                <p className="order-loading">La dirección aparecerá cuando podamos consultar el pedido.</p>
              )}
            </section>
          </div>

          <aside className="order-page-card order-purchase-summary">
            <h2>Detalle de la compra</h2>
            <dl>
              <div><dt>Número de pedido</dt><dd>{order?.id ?? orderId}</dd></div>
              {formattedDate && <div><dt>Fecha</dt><dd>{formattedDate}</dd></div>}
              <div><dt>Estado del pago</dt><dd>{paymentLabel}</dd></div>
              {order && <div><dt>Productos</dt><dd>{money.format(order.subtotal)}</dd></div>}
              {order && <div><dt>Envío</dt><dd>{order.shippingCost ? money.format(order.shippingCost) : 'Gratis'}</dd></div>}
              {order && <div className="order-summary-total"><dt>Total</dt><dd>{money.format(order.total)}</dd></div>}
            </dl>
            <p>El estado del pedido se actualiza cuando recibimos la confirmación de Mercado Pago.</p>
            <button className="button button-dark profile-save-button" type="button" onClick={onBack}>
              Volver a la tienda
            </button>
          </aside>
        </div>
      </div>
    </main>
  )
}
