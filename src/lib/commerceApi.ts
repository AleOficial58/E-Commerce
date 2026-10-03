import type { User } from 'firebase/auth'
import { getFirebaseServices } from './firebase'

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

export async function watchCustomerOrder(
  user: User,
  orderId: string,
  onUpdate: (result: { order: CustomerOrderStatus }) => void,
  onError: (error: Error) => void,
): Promise<() => void> {
  const { app } = await getFirebaseServices()
  const firestoreSdk = await import('firebase/firestore')
  const db = firestoreSdk.getFirestore(app)

  return firestoreSdk.onSnapshot(
    firestoreSdk.doc(db, 'orders', orderId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onError(new Error('No encontramos el pedido asociado a tu cuenta.'))
        return
      }

      const data = snapshot.data()
      if (data.userId !== user.uid) {
        onError(new Error('No encontramos el pedido asociado a tu cuenta.'))
        return
      }
      if (
        typeof data.paymentStatus !== 'string' ||
        typeof data.status !== 'string' ||
        typeof data.total !== 'number'
      ) {
        onError(new Error('El servidor devolvió un estado de pedido no válido.'))
        return
      }

      const items = Array.isArray(data.items)
        ? data.items.flatMap((item: unknown) =>
            typeof item === 'object' && item !== null &&
            'id' in item && typeof item.id === 'string' &&
            'quantity' in item && typeof item.quantity === 'number'
              ? [{ id: item.id, quantity: item.quantity }]
              : [],
          )
        : []

      onUpdate({
        order: {
          id: snapshot.id,
          paymentStatus: data.paymentStatus,
          status: data.status,
          total: data.total,
          items,
        },
      })
    },
    onError,
  )
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
