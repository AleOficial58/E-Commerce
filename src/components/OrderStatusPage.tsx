import { useState } from 'react'
import type { User } from 'firebase/auth'
import type { CustomerOrderStatus, OrderMessage } from '../lib/commerceApi'
import { ThemeToggleButton } from '../lib/theme'
import { OrderMessages } from './OrderMessages'

type PaymentReturnStatus = 'checking' | 'approved' | 'pending' | 'failed' | 'review' | 'error'

type Props = {
  user: User
  orderId: string
  order: CustomerOrderStatus | null
  status: PaymentReturnStatus
  message: string
  onRefresh: () => void
  onBack: () => void
  onViewPurchases?: () => void
  backLabel?: string
  detailMode?: boolean
  deliveryCelebration?: boolean
  money: Intl.NumberFormat
  onCancel?: () => Promise<{ message: string }>
  onIncomingChatMessage?: (orderId: string, message: OrderMessage) => void
}

const localShipmentSteps = [
  { status: 'new', label: 'Compra confirmada' },
  { status: 'preparing', label: 'En preparación' },
  { status: 'local_transit', label: 'En camino' },
  { status: 'out_for_delivery', label: 'En reparto' },
  { status: 'delivered', label: 'Entregada' },
]

const internationalShipmentSteps = [
  { status: 'new', label: 'Compra confirmada' },
  { status: 'preparing', label: 'En preparación' },
  { status: 'international_transit', label: 'En camino desde el exterior' },
  { status: 'customs', label: 'En aduana' },
  { status: 'in_argentina', label: 'En Argentina' },
  { status: 'local_transit', label: 'En camino a tu domicilio' },
  { status: 'out_for_delivery', label: 'En reparto' },
  { status: 'delivered', label: 'Entregada' },
]

const genericShipmentSteps = [
  { status: 'new', label: 'Compra confirmada' },
  { status: 'preparing', label: 'En preparación' },
  { status: 'shipped', label: 'Enviada' },
  { status: 'delivered', label: 'Entregada' },
]

function getStatusTitle(status: PaymentReturnStatus, order: CustomerOrderStatus | null): string {
  if (order?.status === 'cancellation_refund_pending') return 'Reembolso en proceso'
  if (order?.status === 'cancelled' || order?.paymentStatus === 'refunded') return 'Compra cancelada'
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
  if (order?.status === 'cancellation_refund_pending') {
    return 'Solicitamos el reembolso a Mercado Pago. No se despachará el pedido mientras se confirma.'
  }
  if (order?.status === 'cancelled' || order?.paymentStatus === 'refunded') {
    return 'La compra fue cancelada. Si el pago estaba acreditado, Mercado Pago confirmó el reembolso.'
  }
  if (status === 'checking') return 'Estamos consultando el estado confirmado por Mercado Pago.'
  if (status === 'error') return message || 'No pudimos consultar tu pedido. Podés volver a intentarlo.'
  if (status === 'failed') return 'Mercado Pago no confirmó el pago. El pedido no avanzará hasta que se complete.'
  if (status === 'pending') {
    return message || 'Mercado Pago todavía no confirmó el pago. Actualizaremos el estado cuando recibamos la confirmación.'
  }
  if (status === 'review') {
    return message || 'El pago fue aprobado. Estamos revisando la disponibilidad antes de continuar con la preparación.'
  }
  if (order?.status === 'preparing') return 'Tu pago está confirmado y estamos preparando los productos.'
  if (order?.status === 'shipped') return 'Tu pedido ya fue despachado. El estado se actualizará cuando esté entregado.'
  if (order?.status === 'delivered') return 'El pedido figura como entregado. ¡Gracias por comprar en Lúmina!'
  return 'Mercado Pago confirmó el pago y recibimos tu pedido.'
}

export function OrderStatusPage({
  user,
  orderId,
  order,
  status,
  message,
  onRefresh,
  onBack,
  onViewPurchases,
  backLabel = 'Volver a la tienda',
  detailMode = false,
  deliveryCelebration = false,
  money,
  onCancel,
  onIncomingChatMessage,
}: Props) {
  const [messagePrompt, setMessagePrompt] = useState('')
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [cancelMessage, setCancelMessage] = useState('')
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const fulfillmentSteps = order?.shipmentType === 'international'
    ? internationalShipmentSteps
    : order?.shipmentType === 'local'
      ? localShipmentSteps
      : genericShipmentSteps
  const activeStep = (() => {
    if (status !== 'approved' || !order) return -1
    const stage = order.shipmentStage ?? (
      order.status === 'new' ? 'new'
        : order.status === 'preparing' ? 'preparing'
          : order.status === 'shipped'
            ? order.shipmentType === 'international' ? 'international_transit' : 'local_transit'
            : order.status === 'delivered' ? 'delivered' : ''
    )
    return fulfillmentSteps.findIndex((step) => step.status === stage)
  })()
  const paymentLabel = order?.paymentStatus === 'refunded'
    ? 'Reembolsado'
    : order?.paymentStatus === 'cancelled' || order?.status === 'cancelled'
      ? 'Cancelado'
      : order?.paymentStatus === 'approved'
        ? 'Pago acreditado'
    : status === 'failed'
      ? 'Pago no completado'
      : 'Esperando confirmación'
  const address = order?.shipping
  const formattedDate = order?.createdAt
    ? new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(new Date(order.createdAt))
    : null
  const paymentMethodName = (() => {
    switch (order?.paymentMethodId?.toLocaleLowerCase('es-AR')) {
      case 'master':
      case 'mastercard':
        return 'Mastercard'
      case 'visa':
      case 'debvisa':
        return 'Visa'
      case 'amex':
        return 'American Express'
      case 'naranja':
        return 'Naranja X'
      case 'cabal':
        return 'Cabal'
      case 'maestro':
        return 'Maestro'
      default:
        return order?.paymentMethodId || 'Mercado Pago'
    }
  })()
  const paymentTypeName = order?.paymentTypeId === 'credit_card'
    ? 'Crédito'
    : order?.paymentTypeId === 'debit_card'
      ? 'Débito'
      : order?.paymentTypeId === 'account_money'
        ? 'Dinero en cuenta'
        : ''
  const showOrderMessages = detailMode || (
    status === 'approved' &&
    order?.paymentStatus === 'approved' &&
    order.status !== 'cancelled' &&
    order.status !== 'cancellation_refund_pending'
  )
  const showPurchaseCelebration = !detailMode &&
    status === 'approved' &&
    order?.paymentStatus === 'approved' &&
    order.status !== 'cancelled' &&
    order.status !== 'cancellation_refund_pending'
  const showDeliveryCelebration = detailMode &&
    deliveryCelebration &&
    order?.status === 'delivered'

  async function handleReceiptAction(action: 'download' | 'print') {
    if (
      !order ||
      order.paymentStatus !== 'approved' ||
      order.status === 'cancelled' ||
      order.status === 'cancellation_refund_pending'
    ) return
    const printWindow = action === 'print' ? window.open('', '_blank') : null
    if (action === 'print' && !printWindow) {
      setReceiptError('Permití las ventanas emergentes para abrir e imprimir el comprobante.')
      return
    }

    setReceiptBusy(true)
    setReceiptError('')
    try {
      const { createPurchaseReceiptPdf } = await import('../lib/purchaseReceipt')
      const pdf = createPurchaseReceiptPdf(order, money)
      if (action === 'download') {
        pdf.save(`Comprobante-Lumina-${order.id}.pdf`)
        return
      }
      pdf.autoPrint()
      const pdfUrl = URL.createObjectURL(pdf.output('blob'))
      printWindow?.location.replace(pdfUrl)
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000)
    } catch (error) {
      printWindow?.close()
      console.error('No se pudo generar el comprobante de compra.', error)
      setReceiptError(error instanceof Error ? error.message : 'No pudimos generar el comprobante. Intentá nuevamente.')
    } finally {
      setReceiptBusy(false)
    }
  }

  return (
    <main className="order-page">
      <header className="order-page-header">
        <button className="order-page-brand" type="button" onClick={onBack} aria-label="Volver a la tienda">
          lúmina<span aria-hidden="true">✳</span>
        </button>
        <div className="order-page-header-actions">
          <span>{detailMode ? 'Detalle de tu compra' : 'Estado de tu compra'}</span>
          <ThemeToggleButton />
        </div>
      </header>
      <div className="order-page-content">
        <nav className="order-page-breadcrumb" aria-label="Navegación">
          <button type="button" onClick={onBack}>{detailMode ? 'Mis compras' : 'Tienda'}</button>
          <span aria-hidden="true">/</span>
          <span>{detailMode ? 'Detalle de compra' : 'Estado de la compra'}</span>
        </nav>

        <div className="order-page-grid">
          <div className="order-page-main">
            <section
              className={`order-status-card is-${status}${
                showPurchaseCelebration ? ' has-purchase-celebration' : ''
              }${showDeliveryCelebration ? ' has-delivery-celebration' : ''}`}
              aria-live="polite"
            >
              {showPurchaseCelebration ? (
                <div className="order-purchase-celebration" aria-label="Compra confirmada">
                  <div className="order-celebration-confetti" aria-hidden="true">
                    <span /><span /><span /><span /><span /><span /><span /><span />
                  </div>
                  <div className="order-celebration-copy">
                    <span className="order-celebration-status"><span aria-hidden="true">✓</span> Pago acreditado</span>
                    <span className="eyebrow section-eyebrow">
                      PEDIDO {order.id.slice(0, 8).toLocaleUpperCase('es-AR')} · CONFIRMADO
                    </span>
                    <h1>¡Compra realizada!</h1>
                    <p>
                      {order.items.length === 1
                        ? `${order.items[0].name} ya está en preparación.`
                        : `Tus ${order.items.length} productos ya están en preparación.`}
                      {' '}Te vamos a acompañar hasta que lleguen a tus manos.
                    </p>
                    {onViewPurchases && (
                      <button type="button" onClick={onViewPurchases}>
                        Seguir mi pedido <span aria-hidden="true">→</span>
                      </button>
                    )}
                  </div>
                  <div className="order-celebration-product">
                    {order.items[0] && <img src={order.items[0].image} alt={order.items[0].name} />}
                    <span>{order.items[0]?.name ?? 'Tu pedido'}</span>
                    {order.items.length > 1 && <small>y {order.items.length - 1} más</small>}
                    <span className="order-celebration-product-badge" aria-hidden="true">✳</span>
                  </div>
                </div>
              ) : showDeliveryCelebration ? (
                <div className="order-delivery-celebration" aria-label="Pedido entregado">
                  <div className="order-celebration-confetti" aria-hidden="true">
                    <span /><span /><span /><span /><span /><span /><span /><span />
                  </div>
                  <div className="order-delivery-copy">
                    <span className="order-celebration-status"><span aria-hidden="true">✓</span> Entrega confirmada</span>
                    <span className="eyebrow section-eyebrow">UN PAQUETE MENOS, UNA ALEGRÍA MÁS</span>
                    <h1>¡Hola, llegué!</h1>
                    <p>Tu pedido fue entregado. Ojalá disfrutes mucho {order.items[0]?.name ?? 'tus favoritos'}.</p>
                  </div>
                  <div className="order-celebration-product">
                    {order.items[0] && <img src={order.items[0].image} alt={order.items[0].name} />}
                    <span>{order.items[0]?.name ?? 'Tu pedido'}</span>
                    {order.items.length > 1 && <small>y {order.items.length - 1} más</small>}
                    <span className="order-celebration-product-badge" aria-hidden="true">✳</span>
                  </div>
                </div>
              ) : (
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
              )}

              {status === 'approved' && order?.paymentStatus === 'approved' && (
                <>
                  <section className="order-delivery-estimate" aria-label="Estimación de entrega">
                    <span className="eyebrow section-eyebrow">ESTIMACIÓN DE ENTREGA</span>
                    {order?.estimatedDeliveryStart && order.estimatedDeliveryEnd ? (
                      <>
                        <h2>
                          Llega entre el{' '}
                          {new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' })
                            .format(new Date(`${order.estimatedDeliveryStart}T12:00:00`))}
                          {' y el '}
                          {new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' })
                            .format(new Date(`${order.estimatedDeliveryEnd}T12:00:00`))}
                        </h2>
                        <p>El día de la entrega te avisaremos en qué horario vamos a pasar por tu domicilio.</p>
                      </>
                    ) : (
                      <>
                        <h2>Estamos preparando la estimación</h2>
                        <p>El plazo aparecerá acá cuando el equipo confirme el tipo de envío y las fechas.</p>
                      </>
                    )}
                  </section>
                  <ol
                    className={`order-timeline ${
                      order?.shipmentType === 'international'
                        ? 'is-international'
                        : order?.shipmentType === 'local'
                          ? 'is-local'
                          : ''
                    }`}
                    aria-label="Seguimiento del pedido"
                  >
                    {fulfillmentSteps.map((step, index) => {
                      const statusEvent = order?.statusHistory.find((event) => event.status === step.status)
                      const eventDate = statusEvent
                        ? new Intl.DateTimeFormat('es-AR', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(statusEvent.at))
                        : ''
                      return (
                        <li
                          key={step.status}
                          className={index < activeStep ? 'is-complete' : index === activeStep ? 'is-current' : ''}
                        >
                          <span className="order-timeline-marker" aria-hidden="true">
                            {index < activeStep ? '✓' : ''}
                          </span>
                          <span className="order-timeline-label">{step.label}</span>
                          {eventDate && <small>{eventDate}</small>}
                          {index === activeStep && order?.shipmentStageDetail && (
                            <p className="order-timeline-detail">{order.shipmentStageDetail}</p>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                </>
              )}

              {status === 'review' && (
                <div className="order-status-note">Te avisaremos cuando el pedido esté listo para prepararse.</div>
              )}
              {order?.status === 'cancellation_refund_pending' && (
                <div className="order-status-note" role="status">
                  {cancelMessage || 'El pedido está bloqueado para despacho mientras Mercado Pago confirma el reembolso.'}
                </div>
              )}
              {(order?.status === 'cancelled' || order?.paymentStatus === 'refunded') && (
                <div className="order-status-note">La compra ya no avanzará en el proceso de envío.</div>
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
              {order?.status === 'shipped' && (
                <div className="order-tracking-note">
                  {order.trackingCarrier && <strong>Correo: {order.trackingCarrier}</strong>}
                  {order.trackingCode && <span>Código de seguimiento: {order.trackingCode}</span>}
                  {order.trackingUrl && (
                    <a href={order.trackingUrl} target="_blank" rel="noreferrer">Seguir paquete</a>
                  )}
                  {!order.trackingCode && !order.trackingUrl &&
                    <span>El paquete fue marcado como enviado. El equipo actualizará el seguimiento a medida que haya novedades.</span>}
                </div>
              )}
            </section>
            {detailMode && (
              <section className="order-page-card order-help" aria-labelledby="order-help-title">
                <h2 id="order-help-title">Ayuda con la compra</h2>
                <p>Escribinos por el chat si necesitás ayuda. Para cancelar antes del despacho, usá la opción de cancelación del detalle.</p>
                <div className="order-help-actions">
                  {[
                    ['Necesito que llegue', 'Hola, necesito consultar si es posible recibir el pedido antes de la fecha estimada.'],
                    ['Quiero cancelar mi compra', 'Hola, quiero consultar si todavía es posible cancelar esta compra.'],
                    ['Cambiar la dirección de entrega', 'Hola, necesito consultar si todavía es posible cambiar la dirección de entrega.'],
                    ['No voy a estar para recibir la compra', 'Hola, no voy a estar disponible para recibir el pedido. ¿Cómo podemos coordinar?'],
                    ['Necesito ayuda con una devolución', 'Hola, necesito ayuda con una devolución relacionada con esta compra.'],
                  ].map(([label, prompt]) => (
                    <button
                      type="button"
                      key={label}
                      onClick={() => {
                        if (
                          label === 'Quiero cancelar mi compra' &&
                          (order?.canCancel || order?.status === 'cancellation_refund_pending')
                        ) {
                          document.getElementById('order-cancel-area')?.scrollIntoView({ behavior: 'smooth' })
                          return
                        }
                        setMessagePrompt(prompt)
                        document.getElementById(`order-messages-${orderId}`)?.scrollIntoView({ behavior: 'smooth' })
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {showOrderMessages && (
              <OrderMessages
                key={`${orderId}-${messagePrompt}`}
                user={user}
                orderId={orderId}
                initialMessage={messagePrompt}
                onIncomingMessage={onIncomingChatMessage}
              />
            )}
          </div>

          <aside className="order-page-card order-purchase-summary">
            <h2>Detalle de la compra</h2>
            <dl>
              <div><dt>Número de pedido</dt><dd>{order?.id ?? orderId}</dd></div>
              {formattedDate && <div><dt>Fecha</dt><dd>{formattedDate}</dd></div>}
              <div><dt>Estado del pago</dt><dd>{paymentLabel}</dd></div>
              {(order?.paymentStatus === 'approved' || order?.paymentStatus === 'refunded') && (
                <div>
                  <dt>Medio de pago</dt>
                  <dd>
                    {paymentMethodName}
                    {order.paymentCardLastFourDigits
                      ? ` terminada en ${order.paymentCardLastFourDigits}`
                      : ''}
                    {paymentTypeName ? ` · ${paymentTypeName}` : ''}
                    {' · Mercado Pago'}
                  </dd>
                </div>
              )}
              {order && <div><dt>Productos</dt><dd>{money.format(order.subtotal)}</dd></div>}
              {order && <div><dt>Envío</dt><dd>{order.shippingCost ? money.format(order.shippingCost) : 'Gratis'}</dd></div>}
              {order && <div className="order-summary-total"><dt>Total</dt><dd>{money.format(order.total)}</dd></div>}
            </dl>
            <p>
              {detailMode
                ? 'El avance se actualiza cuando Lúmina cambia el estado del pedido.'
                : 'El estado del pedido se actualiza cuando recibimos la confirmación de Mercado Pago.'}
            </p>
            {order?.paymentStatus === 'approved' &&
              order.status !== 'cancelled' &&
              order.status !== 'cancellation_refund_pending' && (
                <div className="order-receipt-actions">
                  <button
                    className="order-receipt-button"
                    type="button"
                    onClick={() => void handleReceiptAction('download')}
                    disabled={receiptBusy}
                  >{receiptBusy ? 'Preparando comprobante…' : 'Descargar comprobante PDF'}</button>
                  <button
                    className="order-receipt-button order-receipt-print"
                    type="button"
                    onClick={() => void handleReceiptAction('print')}
                    disabled={receiptBusy}
                  >Imprimir comprobante</button>
                </div>
              )}
            {receiptError && <p className="order-cancel-error" role="alert">{receiptError}</p>}
            {detailMode && order?.canCancel && onCancel && (
              <div className="order-cancel-area" id="order-cancel-area">
                <p>Podés cancelar antes de que el equipo despache el pedido. Si el pago ya fue acreditado, se solicitará el reembolso a Mercado Pago.</p>
                <button
                  className="order-cancel-button"
                  type="button"
                  disabled={cancelLoading}
                  onClick={() => {
                    if (!window.confirm('¿Querés cancelar esta compra? Si el pago ya fue aprobado, solicitaremos el reembolso a Mercado Pago.')) return
                    setCancelLoading(true)
                    setCancelError('')
                    void onCancel()
                      .then((result) => {
                        setCancelMessage(result.message)
                        onRefresh()
                      })
                      .catch((error: unknown) => {
                        setCancelError(error instanceof Error ? error.message : 'No se pudo cancelar la compra.')
                      })
                      .finally(() => setCancelLoading(false))
                  }}
                >
                  {cancelLoading ? 'Procesando cancelación…' : 'Cancelar compra'}
                </button>
              </div>
            )}
            {detailMode && order?.status === 'cancellation_refund_pending' && onCancel && (
              <div className="order-cancel-area" id="order-cancel-area">
                <p>El reembolso sigue pendiente. Podés volver a consultar la solicitud de forma segura.</p>
                <button
                  className="order-cancel-button"
                  type="button"
                  disabled={cancelLoading}
                  onClick={() => {
                    setCancelLoading(true)
                    setCancelError('')
                    void onCancel()
                      .then((result) => {
                        setCancelMessage(result.message)
                        onRefresh()
                      })
                      .catch((error: unknown) => {
                        setCancelError(error instanceof Error ? error.message : 'No se pudo consultar el reembolso.')
                      })
                      .finally(() => setCancelLoading(false))
                  }}
                >
                  {cancelLoading ? 'Consultando…' : 'Consultar reembolso'}
                </button>
              </div>
            )}
            {cancelError && <p className="order-cancel-error" role="alert">{cancelError}</p>}
            {cancelMessage && order?.status !== 'cancellation_refund_pending' && (
              <p className="order-cancel-success" role="status">{cancelMessage}</p>
            )}
            <button className="button button-dark profile-save-button" type="button" onClick={onBack}>
              {backLabel}
            </button>
          </aside>
        </div>
      </div>
    </main>
  )
}
