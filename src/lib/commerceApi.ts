import type { User } from 'firebase/auth'

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
  quantity: number
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
  total: number
  items: { id: string; quantity: number }[]
}

function isCustomerOrderStatus(value: unknown): value is CustomerOrderStatus {
  return typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'string' &&
    'paymentStatus' in value && typeof value.paymentStatus === 'string' &&
    'status' in value && typeof value.status === 'string' &&
    'total' in value && typeof value.total === 'number' &&
    'items' in value && Array.isArray(value.items)
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
  createdAt?: { _seconds?: number } | null
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
    try {
      if (paymentNeedsSync) {
        await apiRequest(user, `/api/orders/${encodeURIComponent(orderId)}/payment-sync`, {
          method: 'POST',
          body: { paymentId },
        })
        paymentNeedsSync = false
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
      const items = order.items.flatMap((item: unknown) =>
        typeof item === 'object' && item !== null &&
        'id' in item && typeof item.id === 'string' &&
        'quantity' in item && typeof item.quantity === 'number'
          ? [{ id: item.id, quantity: item.quantity }]
          : [],
      )

      if (!active) return
      onUpdate({
        order: {
          id: order.id,
          paymentStatus: order.paymentStatus,
          status: order.status,
          total: order.total,
          items,
        },
      })
      if (
        ['approved', 'rejected', 'cancelled', 'refunded', 'charged_back', 'expired', 'preference_failed']
          .includes(order.paymentStatus) ||
        ['payment_failed', 'payment_expired', 'payment_review'].includes(order.status)
      ) {
        return
      }
    } catch (error) {
      if (!active) return
      onError(error instanceof Error ? error : new Error('No pudimos consultar el estado del pedido.'))
      return
    }

    if (active) timeout = window.setTimeout(() => void poll(), 3000)
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
    const errorMessage =
      typeof result === 'object' && result !== null && 'error' in result
        ? String(result.error)
        : 'No pudimos completar la solicitud.'
    throw new Error(errorMessage)
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
