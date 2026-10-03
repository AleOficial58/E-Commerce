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

export type SimulatedOrderResult = {
  approved: boolean
  orderId?: string
  subtotal?: number
  shippingCost?: number
  total?: number
  message: string
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
  createdAt?: { _seconds?: number } | null
}

export async function checkAdminAccess(user: User): Promise<boolean> {
  const result = await apiRequest<{ isAdmin: boolean }>(user, '/api/admin/status')
  if (typeof result.isAdmin !== 'boolean') throw new Error('El servidor devolvió un permiso de administrador no válido.')
  return result.isAdmin
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

export function submitSimulatedOrder(
  user: User,
  items: CheckoutLine[],
  shipping: ShippingAddress,
  outcome: 'approved' | 'declined',
): Promise<SimulatedOrderResult> {
  return apiRequest(user, '/api/orders', {
    method: 'POST',
    body: { items, shipping, outcome },
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
