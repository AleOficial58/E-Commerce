import type { User } from 'firebase/auth'

export type ShipmentType = 'local' | 'international'
export type ShipmentStage =
  | 'preparing'
  | 'international_transit'
  | 'customs'
  | 'in_argentina'
  | 'local_transit'
  | 'out_for_delivery'
  | 'delivered'

export type ShippingAddress = {
  name: string
  phone: string
  address: string
  apartment: string
  city: string
  province: string
  postalCode: string
}

export type CheckoutLine = {
  productId: string
  expectedPrice: number
  quantity: number
}

export class CommerceApiError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'CommerceApiError'
    this.code = code
  }
}

export type CheckoutPreference = {
  orderId: string
  checkoutUrl: string
  total: number
  expiresAt: string
  paymentMode: 'sandbox' | 'production'
}

export type CustomerOrderStatus = {
  id: string
  paymentStatus: string
  status: string
  canCancel: boolean
  subtotal: number
  shippingCost: number
  total: number
  createdAt: string | null
  statusHistory: { status: string; at: string; detail?: string }[]
  paymentMethodId: string | null
  paymentTypeId: string | null
  paymentCardLastFourDigits: string | null
  shipmentType: ShipmentType | null
  estimatedDeliveryStart: string | null
  estimatedDeliveryEnd: string | null
  shipmentStage: ShipmentStage | null
  shipmentStageDetail: string | null
  trackingCarrier: string | null
  trackingCode: string | null
  trackingUrl: string | null
  shipping: ShippingAddress
  items: {
    id: string
    name: string
    image: string
    price: number
    quantity: number
    lineTotal: number
  }[]
}

export type CustomerOrderSummary = {
  id: string
  paymentStatus: string
  status: string
  total: number
  createdAt: string | null
  shipmentType: ShipmentType | null
  estimatedDeliveryStart: string | null
  estimatedDeliveryEnd: string | null
  items: { name: string; image: string; quantity: number }[]
}

function isCustomerOrderSummary(value: unknown): value is CustomerOrderSummary {
  return typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'string' &&
    'paymentStatus' in value && typeof value.paymentStatus === 'string' &&
    'status' in value && typeof value.status === 'string' &&
    'total' in value && typeof value.total === 'number' && Number.isFinite(value.total) &&
    'createdAt' in value && (typeof value.createdAt === 'string' || value.createdAt === null) &&
    'shipmentType' in value && (value.shipmentType === 'local' || value.shipmentType === 'international' || value.shipmentType === null) &&
    'estimatedDeliveryStart' in value && (typeof value.estimatedDeliveryStart === 'string' || value.estimatedDeliveryStart === null) &&
    'estimatedDeliveryEnd' in value && (typeof value.estimatedDeliveryEnd === 'string' || value.estimatedDeliveryEnd === null) &&
    'items' in value && Array.isArray(value.items) &&
    value.items.every((item: unknown) =>
      typeof item === 'object' && item !== null &&
      'name' in item && typeof item.name === 'string' &&
      'image' in item && typeof item.image === 'string' &&
      'quantity' in item && typeof item.quantity === 'number' && Number.isInteger(item.quantity),
    )
}

function isCustomerOrderStatus(value: unknown): value is CustomerOrderStatus {
  if (
    typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' ||
    !('paymentStatus' in value) || typeof value.paymentStatus !== 'string' ||
    !('status' in value) || typeof value.status !== 'string' ||
    !('canCancel' in value) || typeof value.canCancel !== 'boolean' ||
    !('subtotal' in value) || typeof value.subtotal !== 'number' || !Number.isFinite(value.subtotal) ||
    !('shippingCost' in value) || typeof value.shippingCost !== 'number' || !Number.isFinite(value.shippingCost) ||
    !('total' in value) || typeof value.total !== 'number' || !Number.isFinite(value.total) ||
    !('createdAt' in value) || (typeof value.createdAt !== 'string' && value.createdAt !== null) ||
    !('statusHistory' in value) || !Array.isArray(value.statusHistory) ||
    !('paymentMethodId' in value) || (typeof value.paymentMethodId !== 'string' && value.paymentMethodId !== null) ||
    !('paymentTypeId' in value) || (typeof value.paymentTypeId !== 'string' && value.paymentTypeId !== null) ||
    !('paymentCardLastFourDigits' in value) ||
      (typeof value.paymentCardLastFourDigits !== 'string' && value.paymentCardLastFourDigits !== null) ||
    !('shipmentType' in value) || (value.shipmentType !== 'local' && value.shipmentType !== 'international' && value.shipmentType !== null) ||
    !('estimatedDeliveryStart' in value) || (typeof value.estimatedDeliveryStart !== 'string' && value.estimatedDeliveryStart !== null) ||
    !('estimatedDeliveryEnd' in value) || (typeof value.estimatedDeliveryEnd !== 'string' && value.estimatedDeliveryEnd !== null) ||
    !('shipmentStage' in value) || (typeof value.shipmentStage !== 'string' && value.shipmentStage !== null) ||
    !('shipmentStageDetail' in value) || (typeof value.shipmentStageDetail !== 'string' && value.shipmentStageDetail !== null) ||
    !('trackingCarrier' in value) || (typeof value.trackingCarrier !== 'string' && value.trackingCarrier !== null) ||
    !('trackingCode' in value) || (typeof value.trackingCode !== 'string' && value.trackingCode !== null) ||
    !('trackingUrl' in value) || (typeof value.trackingUrl !== 'string' && value.trackingUrl !== null) ||
    !('shipping' in value) || typeof value.shipping !== 'object' || value.shipping === null ||
    !('items' in value) || !Array.isArray(value.items)
  ) return false

  const shipping = value.shipping
  if (
    !('name' in shipping) || typeof shipping.name !== 'string' ||
    !('phone' in shipping) || typeof shipping.phone !== 'string' ||
    !('address' in shipping) || typeof shipping.address !== 'string' ||
    !('apartment' in shipping) || typeof shipping.apartment !== 'string' ||
    !('city' in shipping) || typeof shipping.city !== 'string' ||
    !('province' in shipping) || typeof shipping.province !== 'string' ||
    !('postalCode' in shipping) || typeof shipping.postalCode !== 'string'
  ) return false
  if (!/^\d{4}$/.test(value.paymentCardLastFourDigits ?? '') && value.paymentCardLastFourDigits !== null) return false
  if (
    value.shipmentStage !== null &&
    ![
      'preparing',
      'international_transit',
      'customs',
      'in_argentina',
      'local_transit',
      'out_for_delivery',
      'delivered',
    ].includes(value.shipmentStage)
  ) return false
  if (!value.statusHistory.every((event: unknown) =>
    typeof event === 'object' && event !== null &&
    'status' in event && typeof event.status === 'string' &&
    'at' in event && typeof event.at === 'string' &&
    (!('detail' in event) || typeof event.detail === 'string'),
  )) return false

  return value.items.every((item: unknown) =>
    typeof item === 'object' && item !== null &&
    'id' in item && typeof item.id === 'string' &&
    'name' in item && typeof item.name === 'string' &&
    'image' in item && typeof item.image === 'string' &&
    'price' in item && typeof item.price === 'number' && Number.isFinite(item.price) &&
    'quantity' in item && typeof item.quantity === 'number' && Number.isInteger(item.quantity) &&
    'lineTotal' in item && typeof item.lineTotal === 'number' && Number.isFinite(item.lineTotal),
  )
}

export async function loadCustomerOrders(user: User): Promise<CustomerOrderSummary[]> {
  const result = await apiRequest<{ orders: unknown }>(user, '/api/orders')
  if (!Array.isArray(result.orders) || !result.orders.every(isCustomerOrderSummary)) {
    throw new Error('El servidor devolvió una lista de compras no válida.')
  }
  return result.orders
}

export async function loadCustomerOrder(user: User, orderId: string): Promise<CustomerOrderStatus> {
  const result = await apiRequest<unknown>(user, `/api/orders/${encodeURIComponent(orderId)}`)
  if (
    typeof result !== 'object' || result === null ||
    !('order' in result) || !isCustomerOrderStatus(result.order)
  ) {
    throw new Error('El servidor devolvió el detalle de compra en un formato no válido.')
  }
  return result.order
}

export function cancelCustomerOrder(user: User, orderId: string): Promise<{ message: string }> {
  return apiRequest(user, `/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
  })
}

export type AdminOrder = {
  id: string
  userId: string
  customerEmail: string
  customerName: string
  items: {
    id: string
    name: string
    category: string
    description: string
    image: string
    price: number
    quantity: number
    lineTotal: number
  }[]
  shipping: ShippingAddress
  subtotal: number
  shippingCost: number
  total: number
  paymentStatus: string
  status: string
  paymentMethod?: string
  shipmentType?: ShipmentType
  estimatedDeliveryStart?: string
  estimatedDeliveryEnd?: string
  shipmentStage?: ShipmentStage
  shipmentStageDetail?: string
  trackingCarrier?: string
  trackingCode?: string
  trackingUrl?: string
  createdAt?: { _seconds?: number } | null
}

export type OrderMessage = {
  id: string
  authorRole: 'customer' | 'admin'
  authorName: string
  body: string
  createdAt: string | null
}

export type AdminShipmentUpdate = {
  shipmentType: ShipmentType
  estimatedDeliveryStart: string
  estimatedDeliveryEnd: string
  shipmentStage: ShipmentStage
  shipmentStageDetail: string
  trackingCarrier: string
  trackingCode: string
  trackingUrl: string
}

export async function checkAdminAccess(user: User): Promise<boolean> {
  const result = await apiRequest<{ isAdmin: boolean }>(user, '/api/admin/status')
  if (typeof result.isAdmin !== 'boolean') throw new Error('El servidor devolvió un permiso de administrador no válido.')
  return result.isAdmin
}

export function pollCustomerOrder(
  user: User,
  orderId: string,
  onUpdate: (result: { order: CustomerOrderStatus }) => void,
  onError: (error: Error) => void,
  paymentId = '',
): () => void {
  let active = true
  let timeout: number | undefined
  let paymentNeedsSync = true

  const poll = async () => {
    let nextPollInterval = 3000
    let paymentSyncError: Error | null = null
    try {
      if (paymentNeedsSync) {
        try {
          await apiRequest(user, `/api/orders/${encodeURIComponent(orderId)}/payment-sync`, {
            method: 'POST',
            body: { paymentId },
          })
          paymentNeedsSync = false
        } catch (error) {
          if (!active) return
          paymentSyncError = error instanceof Error
            ? error
            : new Error('No pudimos conciliar el pago con Mercado Pago.')
        }
      }
      const result = await apiRequest<unknown>(
        user,
        `/api/orders/${encodeURIComponent(orderId)}`,
      )
      if (
        typeof result !== 'object' || result === null ||
        !('order' in result) || !isCustomerOrderStatus(result.order)
      ) {
        throw new Error('El servidor devolvió un estado de pedido no válido.')
      }

      const order = result.order
      if (!active) return
      onUpdate({ order })
      nextPollInterval = order.paymentStatus === 'approved' ? 15_000 : 3000
      if (paymentSyncError && order.paymentStatus !== 'approved') {
        onError(paymentSyncError)
        return
      }
      if (
        ['rejected', 'cancelled', 'refunded', 'charged_back', 'expired', 'preference_failed']
          .includes(order.paymentStatus) ||
        ['payment_failed', 'payment_expired', 'delivered'].includes(order.status)
      ) {
        return
      }
    } catch (error) {
      if (!active) return
      onError(error instanceof Error ? error : new Error('No pudimos consultar el estado del pedido.'))
      return
    }
    if (active) {
      timeout = window.setTimeout(() => void poll(), nextPollInterval)
    }
  }

  void poll()
  return () => {
    active = false
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

export function grantAdminAccess(user: User, email: string): Promise<{ message: string }> {
  return apiRequest(user, '/api/admin/users', {
    method: 'POST',
    body: { email },
  })
}

export function revokeOwnAdminAccess(user: User): Promise<{ message: string }> {
  return apiRequest(user, '/api/admin/self-revoke', { method: 'POST' })
}

async function apiRequest<T>(
  user: User,
  endpoint: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await user.getIdToken()
  const response = await fetch(endpoint, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })

  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error(
      response.ok
        ? 'El servidor devolvió una respuesta no válida.'
        : 'No pudimos conectar con el servidor. Asegurate de iniciar npm run dev:full.',
    )
  }

  if (!response.ok) {
    const errorMessage = typeof result === 'object' && result !== null && 'error' in result
      ? String(result.error)
      : 'No pudimos completar la solicitud.'
    const code = typeof result === 'object' && result !== null && 'code' in result &&
      typeof result.code === 'string'
      ? result.code
      : undefined
    throw new CommerceApiError(errorMessage, code)
  }
  return result as T
}

export function createCheckoutPreference(
  user: User,
  items: CheckoutLine[],
  shipping: ShippingAddress,
): Promise<CheckoutPreference> {
  return apiRequest(user, '/api/payments/mercadopago/preference', {
    method: 'POST',
    body: { items, shipping },
  })
}

export async function loadAdminOrders(user: User): Promise<AdminOrder[]> {
  const result = await apiRequest<{ orders: AdminOrder[] }>(user, '/api/admin/orders')
  if (!Array.isArray(result.orders)) throw new Error('El servidor devolvió una lista de pedidos no válida.')
  return result.orders
}

export function updateAdminOrderStatus(
  user: User,
  orderId: string,
  status: 'preparing' | 'shipped' | 'delivered',
): Promise<{ message: string }> {
  return apiRequest(user, `/api/admin/orders/${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    body: { status },
  })
}

export function updateAdminShipment(
  user: User,
  orderId: string,
  shipment: AdminShipmentUpdate,
): Promise<{ message: string }> {
  return apiRequest(user, `/api/admin/orders/${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    body: shipment,
  })
}

export async function loadOrderMessages(user: User, orderId: string): Promise<OrderMessage[]> {
  const result = await apiRequest<{ messages: unknown }>(
    user,
    `/api/orders/${encodeURIComponent(orderId)}/messages`,
  )
  if (!Array.isArray(result.messages) || !result.messages.every((message: unknown) =>
    typeof message === 'object' && message !== null &&
    'id' in message && typeof message.id === 'string' &&
    'authorRole' in message && (message.authorRole === 'customer' || message.authorRole === 'admin') &&
    'authorName' in message && typeof message.authorName === 'string' &&
    'body' in message && typeof message.body === 'string' &&
    'createdAt' in message && (typeof message.createdAt === 'string' || message.createdAt === null),
  )) throw new Error('El servidor devolvió mensajes en un formato no válido.')
  return result.messages
}

export function sendOrderMessage(
  user: User,
  orderId: string,
  body: string,
): Promise<{ message: string }> {
  return apiRequest(user, `/api/orders/${encodeURIComponent(orderId)}/messages`, {
    method: 'POST',
    body: { body },
  })
}
