import './env.js'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken, type UserRecord } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { products as demoProducts } from '../src/data/products.js'
import {
  EmailDeliveryError,
  getActionCodeSettings,
  getEmailTransport,
  isEmailConfigured,
  sendActionEmail,
} from './email.js'

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: DecodedIdToken
    }
  }
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

const projectId = process.env.FIREBASE_PROJECT_ID
const mercadoPagoMode = process.env.MERCADO_PAGO_MODE ?? 'sandbox'
if (!['sandbox', 'production'].includes(mercadoPagoMode)) {
  throw new Error('MERCADO_PAGO_MODE debe ser sandbox o production.')
}
const appUrl = new URL(
  process.env.PUBLIC_APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173',
)
const googleCredentialsAvailable = Boolean(
  (process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
    process.env.K_SERVICE ||
    process.env.GOOGLE_CLOUD_PROJECT,
)
const firebaseConfigured = Boolean(projectId && googleCredentialsAvailable)
const firebaseApp =
  getApps()[0] ??
  initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  })
const firebaseAuth = getAuth(firebaseApp)
const firestore = getFirestore(firebaseApp)

function isBootstrapAdmin(email?: string | null, emailVerified?: boolean): boolean {
  if (!email || emailVerified !== true) return false
  const normalizedEmail = email.trim().toLocaleLowerCase('en-US')
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .some((value) => value.trim().toLocaleLowerCase('en-US') === normalizedEmail)
}

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: [
          "'self'",
          'https://*.googleapis.com',
          'https://*.firebaseapp.com',
          'https://*.firebaseio.com',
          'wss://*.firebaseio.com',
        ],
        frameSrc: ['https://*.firebaseapp.com', 'https://accounts.google.com'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
)
app.use(
  '/api',
  cors({
    origin(origin, callback) {
      if (!origin || origin === appUrl.origin) {
        callback(null, true)
        return
      }
      callback(new ApiError('Origen no permitido.', 403))
    },
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  }),
)
app.use(express.json({ limit: '10kb' }))

const publicActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 4,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hubo varios intentos. Esperá unos minutos y volvé a probar.' },
})

const authenticatedActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hubo varios intentos. Esperá unos minutos y volvé a probar.' },
})

const adminGrantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hubo varias asignaciones de permisos. Esperá unos minutos y volvé a probar.' },
})

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hubo varios intentos de compra. Esperá unos minutos y volvé a probar.' },
})

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hubo varias reseñas desde esta conexión. Esperá un rato antes de volver a publicar.' },
})

function requireFirebaseServices(_request: Request, _response: Response, next: NextFunction) {
  if (!firebaseConfigured) {
    next(new ApiError('La API todavía no tiene credenciales de Firebase Admin configuradas.', 503))
    return
  }
  next()
}

async function requireAdmin(request: Request, _response: Response, next: NextFunction) {
  const uid = request.authenticatedUser?.uid
  if (!uid) {
    next(new ApiError('Iniciá sesión para realizar esta acción.', 401))
    return
  }
  try {
    const admin = await firestore.doc(`admins/${uid}`).get()
    if (
      (!admin.exists || admin.get('active') !== true) &&
      !isBootstrapAdmin(request.authenticatedUser?.email, request.authenticatedUser?.email_verified)
    ) {
      next(new ApiError('Esta cuenta no tiene permisos de administración.', 403))
      return
    }
    next()
  } catch (error) {
    next(error)
  }
}

function readCheckoutRequest(request: Request) {
  const items: unknown = request.body?.items
  const shipping: unknown = request.body?.shipping
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    throw new ApiError('El bolso no tiene productos válidos.', 400)
  }
  const parsedItems = items.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('productId' in item) ||
      !('quantity' in item) ||
      typeof item.productId !== 'string' ||
      !/^[a-z0-9-]{1,80}$/.test(item.productId) ||
      !Number.isInteger(item.quantity) ||
      typeof item.quantity !== 'number' ||
      item.quantity < 1 ||
      item.quantity > 20
    ) {
      throw new ApiError('El bolso contiene un producto o una cantidad inválida.', 400)
    }
    return { productId: item.productId, quantity: item.quantity }
  })
  if (new Set(parsedItems.map((item) => item.productId)).size !== parsedItems.length) {
    throw new ApiError('El bolso contiene productos duplicados.', 400)
  }
  if (
    typeof shipping !== 'object' ||
    shipping === null ||
    !('name' in shipping) ||
    !('phone' in shipping) ||
    !('address' in shipping) ||
    !('apartment' in shipping) ||
    !('city' in shipping) ||
    !('province' in shipping) ||
    !('postalCode' in shipping)
  ) {
    throw new ApiError('Completá los datos de entrega antes de confirmar.', 400)
  }
  const shippingFields = ['name', 'phone', 'address', 'apartment', 'city', 'province', 'postalCode'] as const
  const parsedShipping = Object.fromEntries(
    shippingFields.map((field) => {
      const value = shipping[field]
      const maxLength = field === 'address' ? 120 : field === 'apartment' ? 60 : field === 'phone' ? 30 : 80
      if (typeof value !== 'string' || value.trim().length > maxLength) {
        throw new ApiError('Revisá los datos de entrega e intentá de nuevo.', 400)
      }
      return [field, value.trim()]
    }),
  )
  if (
    !parsedShipping.name ||
    !parsedShipping.phone ||
    !parsedShipping.address ||
    !parsedShipping.city ||
    !parsedShipping.province ||
    !parsedShipping.postalCode
  ) {
    throw new ApiError('Completá nombre, teléfono y domicilio para continuar.', 400)
  }
  return { items: parsedItems, shipping: parsedShipping }
}

function getDemoProduct(productId: string) {
  return demoProducts.find((product) => product.id === productId)
}

function getProductReviewDocumentId(productId: string, userId: string): string {
  return createHash('sha256').update(`${productId}:${userId}`).digest('hex')
}

function getProductSnapshot(data: Record<string, unknown>, productId: string) {
  const seed = getDemoProduct(productId)
  const name = typeof data.name === 'string' ? data.name : seed?.name
  const category = typeof data.category === 'string' ? data.category : seed?.category
  const description = typeof data.description === 'string' ? data.description : seed?.description
  const image = typeof data.image === 'string' ? data.image : seed?.image
  const price = typeof data.price === 'number' ? data.price : seed?.price
  if (!name || !category || !description || !image || typeof price !== 'number' || price <= 0 || price > 1_000_000_000) return null
  return {
    id: productId,
    name,
    category,
    description,
    image,
    price,
    stock: typeof data.stock === 'number' && Number.isInteger(data.stock) && data.stock >= 0
      ? data.stock
      : seed
        ? 50
        : -1,
    active: typeof data.active === 'boolean' ? data.active : true,
  }
}

type OrderLineItem = {
  id: string
  name: string
  category: string
  description: string
  image: string
  price: number
  stock: number
  active: boolean
  quantity: number
  lineTotal: number
}

type MercadoPagoPayment = {
  id: number | string
  external_reference?: string | null
  transaction_amount?: number
  currency_id?: string
  status?: string
  live_mode?: boolean
}

function getMercadoPagoAccessToken(): string {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim()
  if (!token) throw new ApiError('Los pagos online todavía no están configurados.', 503)
  if (mercadoPagoMode === 'production' && process.env.MERCADO_PAGO_ALLOW_PRODUCTION !== 'true') {
    throw new ApiError('Los pagos productivos están deshabilitados hasta completar la habilitación de producción.', 503)
  }
  return token
}

async function createMercadoPagoPreference(
  orderId: string,
  customerEmail: string,
  items: OrderLineItem[],
  total: number,
  expiresAt: Date,
) {
  const accessToken = getMercadoPagoAccessToken()
  if (!process.env.MERCADO_PAGO_WEBHOOK_SECRET) {
    throw new ApiError('Falta configurar la clave de notificaciones seguras de Mercado Pago.', 503)
  }

  const returnUrl = new URL('/', appUrl)
  returnUrl.searchParams.set('payment', 'return')
  returnUrl.searchParams.set('order_id', orderId)
  let mercadoPagoResponse: globalThis.Response
  try {
    mercadoPagoResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': orderId,
      },
      body: JSON.stringify({
        items: [
          ...items.map((item) => ({
            id: item.id,
            title: item.name,
            quantity: item.quantity,
            currency_id: 'ARS',
            unit_price: item.price,
          })),
          ...(total > items.reduce((subtotal, item) => subtotal + item.lineTotal, 0)
            ? [{
                id: 'shipping',
                title: 'Envío',
                quantity: 1,
                currency_id: 'ARS',
                unit_price: total - items.reduce((subtotal, item) => subtotal + item.lineTotal, 0),
              }]
            : []),
        ],
        payer: { email: customerEmail },
        external_reference: orderId,
        metadata: { order_id: orderId },
        back_urls: {
          success: returnUrl.toString(),
          pending: returnUrl.toString(),
          failure: returnUrl.toString(),
        },
        auto_return: 'approved',
        notification_url: new URL('/api/payments/mercadopago/webhook', appUrl).toString(),
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: expiresAt.toISOString(),
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ApiError('No pudimos conectar con Mercado Pago. Tu stock reservado no se perdió; intentá de nuevo más tarde.', 503)
  }

  let result: unknown
  try {
    result = await mercadoPagoResponse.json()
  } catch {
    throw new ApiError('Mercado Pago devolvió una respuesta no válida.', 502)
  }
  if (!mercadoPagoResponse.ok || typeof result !== 'object' || result === null) {
    console.error('Mercado Pago rechazó la creación del checkout.', { status: mercadoPagoResponse.status })
    throw new ApiError('No pudimos iniciar el pago. Revisá la configuración de Mercado Pago e intentá otra vez.', 502)
  }
  const preference = result as Record<string, unknown>
  const checkoutUrl = mercadoPagoMode === 'sandbox'
    ? preference.sandbox_init_point
    : preference.init_point
  if (
    typeof preference.id !== 'string' ||
    typeof checkoutUrl !== 'string' ||
    !checkoutUrl.startsWith('https://')
  ) {
    throw new ApiError('Mercado Pago no devolvió un enlace de pago seguro.', 502)
  }
  return { id: preference.id, checkoutUrl }
}

function isValidMercadoPagoSignature(request: Request, dataId: string): boolean {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET
  const signature = request.get('x-signature')
  const requestId = request.get('x-request-id')
  if (!secret || !signature || !requestId) return false

  const fields = Object.fromEntries(
    signature.split(',').map((field) => {
      const separator = field.indexOf('=')
      return separator < 0
        ? [field.trim(), '']
        : [field.slice(0, separator).trim(), field.slice(separator + 1).trim()]
    }),
  )
  const timestamp = fields.ts
  const suppliedSignature = fields.v1
  if (!timestamp || !suppliedSignature || !/^\d+$/.test(timestamp)) return false

  if (!/^[a-f\d]{64}$/i.test(suppliedSignature)) return false
  const manifest = `id:${dataId.toLocaleLowerCase('en-US')};request-id:${requestId};ts:${timestamp};`
  const expectedSignature = createHmac('sha256', secret).update(manifest).digest()
  const receivedSignature = Buffer.from(suppliedSignature, 'hex')
  return receivedSignature.length === expectedSignature.length &&
    timingSafeEqual(receivedSignature, expectedSignature)
}

async function getMercadoPagoPayment(paymentId: string): Promise<MercadoPagoPayment> {
  const accessToken = getMercadoPagoAccessToken()
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    console.error('Mercado Pago no permitió consultar un pago notificado.', { status: response.status })
    throw new ApiError('No pudimos verificar el pago notificado.', 502)
  }
  const payment: unknown = await response.json()
  if (typeof payment !== 'object' || payment === null || !('id' in payment)) {
    throw new ApiError('Mercado Pago devolvió datos de pago no válidos.', 502)
  }
  return payment as MercadoPagoPayment
}

async function releaseOrderInventory(
  orderId: string,
  paymentStatus: string,
  orderStatus: string,
) {
  const orderRef = firestore.doc(`orders/${orderId}`)
  await firestore.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef)
    if (!orderSnapshot.exists) return
    const order = orderSnapshot.data() ?? {}
    if (order.inventoryHeld !== true || order.paymentStatus === 'approved') return

    const orderItems = Array.isArray(order.items) ? order.items : []
    const productEntries = orderItems.flatMap((item) =>
      typeof item === 'object' && item !== null &&
      'id' in item && typeof item.id === 'string' &&
      'quantity' in item && typeof item.quantity === 'number'
        ? [{ item, reference: firestore.doc(`products/${item.id}`) }]
        : [],
    )
    const productSnapshots = await Promise.all(
      productEntries.map(({ reference }) => transaction.get(reference)),
    )
    productEntries.forEach(({ item, reference }, index) => {
      const stock = productSnapshots[index]?.get('stock')
      if (typeof stock === 'number') {
        transaction.update(reference, {
          stock: stock + item.quantity,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    })
    transaction.update(orderRef, {
      paymentStatus,
      inventoryHeld: false,
      status: orderStatus,
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
}

async function expirePendingOrders() {
  const pendingOrders = await firestore.collection('orders')
    .where('status', '==', 'pending_payment')
    .limit(500)
    .get()
  const now = Date.now()
  await Promise.all(pendingOrders.docs.map(async (document) => {
    const expiresAt = document.get('expiresAt')
    if (!(expiresAt instanceof Timestamp) || expiresAt.toMillis() > now) return
    await releaseOrderInventory(document.id, 'expired', 'payment_expired')
  }))
}

async function settleMercadoPagoPayment(payment: MercadoPagoPayment) {
  const orderId = payment.external_reference
  if (!orderId || !/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) {
    throw new ApiError('El pago no está asociado a un pedido válido.', 400)
  }
  const orderRef = firestore.doc(`orders/${orderId}`)
  await firestore.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef)
    if (!orderSnapshot.exists) throw new ApiError('No encontramos el pedido asociado al pago.', 404)
    const order = orderSnapshot.data() ?? {}
    if (
      typeof payment.transaction_amount !== 'number' ||
      payment.transaction_amount !== order.total ||
      payment.currency_id !== 'ARS'
    ) {
      throw new ApiError('El importe notificado no coincide con el pedido.', 409)
    }

    const paymentStatus = typeof payment.status === 'string' ? payment.status : 'unknown'
    if (paymentStatus === 'approved') {
      if (order.paymentStatus === 'approved') return
      const orderItems = Array.isArray(order.items) ? order.items : []
      const productEntries = orderItems.flatMap((item) =>
        typeof item === 'object' && item !== null &&
        'id' in item && typeof item.id === 'string' &&
        'quantity' in item && typeof item.quantity === 'number'
          ? [{ item, reference: firestore.doc(`products/${item.id}`) }]
          : [],
      )
      const productSnapshots = await Promise.all(
        productEntries.map(({ reference }) => transaction.get(reference)),
      )
      let hasInventory = productEntries.length === orderItems.length
      const inventoryHeld = order.inventoryHeld === true
      productEntries.forEach(({ item }, index) => {
        const snapshot = productSnapshots[index]
        if (!snapshot?.exists) {
          hasInventory = false
          return
        }
        const stock = snapshot.get('stock')
        const quantity = item.quantity
        if (
          typeof stock !== 'number' ||
          stock < 0 ||
          typeof quantity !== 'number' ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          (!inventoryHeld && stock < quantity)
        ) {
          hasInventory = false
        }
      })
      if (hasInventory && !inventoryHeld) {
        productEntries.forEach(({ item, reference }, index) => {
          const stock = productSnapshots[index]?.get('stock')
          if (typeof stock === 'number') {
            transaction.update(reference, {
              stock: stock - item.quantity,
              updatedAt: FieldValue.serverTimestamp(),
            })
          }
        })
      }
      transaction.update(orderRef, {
        paymentStatus: 'approved',
        paymentId: String(payment.id),
        inventoryHeld: false,
        status: hasInventory ? 'new' : 'payment_review',
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (hasInventory) {
        const userId = typeof order.userId === 'string' ? order.userId : ''
        productEntries.forEach(({ item }) => {
          if (userId) {
            transaction.set(
              firestore.doc(`verifiedPurchases/${userId}_${item.id}`),
              {
                userId,
                productId: item.id,
                orderId,
                createdAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
          }
        })
      }
      return
    }

    if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(paymentStatus)) {
      if (order.paymentStatus === 'approved') {
        if (paymentStatus === 'refunded' || paymentStatus === 'charged_back') {
          transaction.update(orderRef, {
            paymentStatus,
            paymentId: String(payment.id),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        return
      }
      if (order.inventoryHeld !== true) return
      const orderItems = Array.isArray(order.items) ? order.items : []
      const productEntries = orderItems.flatMap((item) =>
        typeof item === 'object' && item !== null &&
        'id' in item && typeof item.id === 'string' &&
        'quantity' in item && typeof item.quantity === 'number'
          ? [{ item, reference: firestore.doc(`products/${item.id}`) }]
          : [],
      )
      const productSnapshots = await Promise.all(
        productEntries.map(({ reference }) => transaction.get(reference)),
      )
      productEntries.forEach(({ item, reference }, index) => {
        const stock = productSnapshots[index]?.get('stock')
        if (typeof stock === 'number') {
          transaction.update(reference, {
            stock: stock + item.quantity,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      })
      transaction.update(orderRef, {
        paymentStatus,
        paymentId: String(payment.id),
        inventoryHeld: false,
        status: 'payment_failed',
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  })
}

function requireEmailConfiguration(_request: Request, _response: Response, next: NextFunction) {
  if (!isEmailConfigured()) {
    next(new ApiError('La API todavía no tiene un proveedor de correo configurado.', 503))
    return
  }
  next()
}

async function requireUser(request: Request, _response: Response, next: NextFunction) {
  const authorization = request.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) {
    next(new ApiError('Iniciá sesión para realizar esta acción.', 401))
    return
  }

  try {
    request.authenticatedUser = await firebaseAuth.verifyIdToken(token)
    next()
  } catch {
    next(new ApiError('La sesión venció. Iniciá sesión nuevamente.', 401))
  }
}

function readEmail(request: Request): string {
  const email: unknown = request.body?.email
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new ApiError('Ingresá un email válido.', 400)
  }
  return email.trim()
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : ''
}

function handleError(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.message })
    return
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  ) {
    response.status(400).json({ error: 'El cuerpo de la solicitud no contiene JSON válido.' })
    return
  }

  if (error instanceof EmailDeliveryError) {
    response.status(503).json({ error: error.message })
    return
  }

  const code = errorCode(error)
  if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
    response.status(202).json({
      message: 'Si existe una cuenta con ese email, vas a recibir un correo con los próximos pasos.',
    })
    return
  }

  if (code === 'auth/unauthorized-continue-uri') {
    response.status(503).json({
      error: 'Firebase no autorizó el dominio de la tienda. Agregá el dominio actual en Authentication → Settings → Authorized domains y volvé a intentar.',
    })
    return
  }

  if (code === 'auth/invalid-continue-uri') {
    response.status(503).json({
      error: 'La URL configurada para volver a Lúmina no es válida. Revisá PUBLIC_APP_URL en .env.server.',
    })
    return
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'command' in error &&
    'responseCode' in error
  ) {
    console.error('El proveedor SMTP rechazó el envío.', {
      responseCode: error.responseCode,
      command: error.command,
    })
    response.status(503).json({
      error: 'Firebase generó el enlace, pero Brevo rechazó el envío. Revisá el remitente verificado, login y clave SMTP.',
    })
    return
  }

  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNECTIONTIMEDOUT'].includes(code)) {
    console.error('Se agotó el tiempo de espera de SMTP.', code)
    response.status(503).json({
      error: 'El servidor de correo no respondió a tiempo. En Render, probá la API de Brevo con BREVO_API_KEY en vez de SMTP.',
    })
    return
  }

  if (code === '9' || code === 'failed-precondition') {
    console.error('Firestore rechazó la operación por una condición pendiente.', code)
    response.status(503).json({
      error: 'Firestore requiere un índice o una condición que todavía no está lista. Publicá la configuración con `firebase deploy --only firestore` y volvé a intentar.',
    })
    return
  }

  console.error('Falló una operación de la API.', {
    code: code || 'unknown_error',
    error: error instanceof Error ? error.message : 'No se recibió un objeto Error.',
  })
  response.status(503).json({
    error: 'No pudimos completar la operación. Revisá la conexión y la configuración del servidor e intentá de nuevo.',
  })
}

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    firebaseAdminConfigured: firebaseConfigured,
    smtpConfigured: isEmailConfigured(),
    emailTransport: getEmailTransport(),
    mercadoPagoMode,
    mercadoPagoConfigured: Boolean(
      process.env.MERCADO_PAGO_ACCESS_TOKEN &&
      process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    ),
  })
})

app.get(
  '/api/admin/status',
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      if (!uid) throw new ApiError('Iniciá sesión para consultar este permiso.', 401)
      const adminRef = firestore.doc(`admins/${uid}`)
      const admin = await adminRef.get()
      const bootstrapAdmin = isBootstrapAdmin(
        request.authenticatedUser?.email,
        request.authenticatedUser?.email_verified,
      )
      if (bootstrapAdmin && (!admin.exists || admin.get('active') !== true)) {
        await adminRef.set({
          email: request.authenticatedUser?.email,
          active: true,
          grantedBy: 'environment-bootstrap',
          grantedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      response.json({
        isAdmin: (admin.exists && admin.get('active') === true) ||
          bootstrapAdmin,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  '/api/admin/users',
  requireFirebaseServices,
  requireUser,
  requireAdmin,
  adminGrantLimiter,
  async (request, response, next) => {
    try {
      const emailValue: unknown = request.body?.email
      const email = typeof emailValue === 'string' ? emailValue.trim().toLowerCase() : ''
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ApiError('Ingresá un email válido.', 400)
      }

      let targetUser: UserRecord
      try {
        targetUser = await firebaseAuth.getUserByEmail(email)
      } catch (error) {
        if (errorCode(error) === 'auth/user-not-found') {
          throw new ApiError('No encontramos una cuenta de Lúmina con ese email. La persona debe registrarse primero.', 404)
        }
        throw error
      }
      if (!targetUser.emailVerified) {
        throw new ApiError('La cuenta existe, pero primero debe verificar su email para recibir permisos de administración.', 409)
      }

      const adminRef = firestore.doc(`admins/${targetUser.uid}`)
      const existingAdmin = await adminRef.get()
      if (existingAdmin.exists && existingAdmin.get('active') === true) {
        response.json({ message: 'Esa cuenta ya tiene permisos de administración.' })
        return
      }

      await adminRef.set({
        email,
        active: true,
        grantedBy: request.authenticatedUser?.uid ?? '',
        grantedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      response.status(201).json({
        message: `Se habilitó el rol Admin para ${email}. La cuenta puede cerrar sesión y volver a ingresar.`,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        next(error)
        return
      }
      console.error('Falló la asignación de permisos de administración.', errorCode(error) || 'unknown_error')
      response.status(503).json({ error: 'No pudimos guardar los permisos de administración. Intentá de nuevo.' })
    }
  },
)

app.post(
  '/api/email/verification',
  authenticatedActionLimiter,
  requireFirebaseServices,
  requireEmailConfiguration,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      if (!uid) throw new ApiError('Iniciá sesión para realizar esta acción.', 401)

      const user = await firebaseAuth.getUser(uid)
      if (!user.email) throw new ApiError('La cuenta no tiene una dirección de email.', 400)
      if (user.emailVerified) {
        response.status(200).json({ message: 'La dirección ya está verificada.' })
        return
      }

      const link = await firebaseAuth.generateEmailVerificationLink(
        user.email,
        getActionCodeSettings(),
      )
      await sendActionEmail('verifyEmail', link, user.email, user.displayName)
      response.status(202).json({ message: 'Te enviamos un correo para verificar tu cuenta.' })
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  '/api/email/password-reset',
  publicActionLimiter,
  requireFirebaseServices,
  requireEmailConfiguration,
  async (request, response, next) => {
    try {
      const email = readEmail(request)
      const link = await firebaseAuth.generatePasswordResetLink(
        email,
        getActionCodeSettings(),
      )
      await sendActionEmail('resetPassword', link, email)
      response.status(202).json({
        message: 'Si existe una cuenta con ese email, vas a recibir un correo con los próximos pasos.',
      })
    } catch (error) {
      if (errorCode(error) === 'auth/user-not-found') {
        response.status(202).json({
          message: 'Si existe una cuenta con ese email, vas a recibir un correo con los próximos pasos.',
        })
        return
      }
      next(error)
    }
  },
)

app.post(
  '/api/payments/mercadopago/preference',
  checkoutLimiter,
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    let orderId = ''
    try {
      const uid = request.authenticatedUser?.uid
      if (!uid) throw new ApiError('Iniciá sesión antes de confirmar el pedido.', 401)
      const email = request.authenticatedUser?.email
      if (!email) throw new ApiError('La cuenta no tiene un email válido para iniciar el pago.', 400)
      getMercadoPagoAccessToken()
      if (!process.env.MERCADO_PAGO_WEBHOOK_SECRET) {
        throw new ApiError('Falta configurar la clave de notificaciones seguras de Mercado Pago.', 503)
      }
      const { items, shipping } = readCheckoutRequest(request)
      await expirePendingOrders()

      const orderRef = firestore.collection('orders').doc()
      orderId = orderRef.id
      const productRefs = items.map(({ productId }) => firestore.doc(`products/${productId}`))
      const customerProfileRef = firestore.doc(`users/${uid}`)
      const reservation = await firestore.runTransaction(async (transaction) => {
        const [snapshots, customerProfileSnapshot] = await Promise.all([
          Promise.all(productRefs.map((reference) => transaction.get(reference))),
          transaction.get(customerProfileRef),
        ])
        const lineItems = items.map(({ productId, quantity }, index) => {
          const snapshot = snapshots[index]
          const data = snapshot?.exists ? snapshot.data() ?? {} : {}
          const product = getProductSnapshot(data, productId)
          if (!product || !product.active) {
            throw new ApiError(`El producto ${productId} ya no está disponible.`, 409)
          }
          if (!Number.isInteger(product.stock) || product.stock < quantity) {
            throw new ApiError(`${product.name} no tiene stock suficiente.`, 409)
          }
          return { ...product, quantity, lineTotal: product.price * quantity }
        })
        const subtotal = lineItems.reduce((total, item) => total + item.lineTotal, 0)
        const shippingCost = subtotal >= 45000 ? 0 : 3500
        const total = subtotal + shippingCost
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

        lineItems.forEach((item, index) => {
          const productRef = productRefs[index]
          const snapshot = snapshots[index]
          if (!productRef) return
          transaction.set(
            productRef,
            {
              ...(snapshot?.exists
                ? {}
                : {
                    id: item.id,
                    name: item.name,
                    category: item.category,
                    description: item.description,
                    image: item.image,
                    price: item.price,
                    imageTone: getDemoProduct(item.id)?.imageTone ?? 'peach',
                    stock: 50,
                    active: true,
                  }),
              stock: item.stock - item.quantity,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
        })
        transaction.set(
          customerProfileRef,
          {
            name: shipping.name,
            email: request.authenticatedUser?.email ?? '',
            phone: shipping.phone,
            address: shipping.address,
            apartment: shipping.apartment,
            city: shipping.city,
            province: shipping.province,
            postalCode: shipping.postalCode,
            updatedAt: FieldValue.serverTimestamp(),
            ...(!customerProfileSnapshot.exists
              ? { createdAt: FieldValue.serverTimestamp() }
              : {}),
          },
          { merge: true },
        )
        transaction.create(orderRef, {
          id: orderRef.id,
          userId: uid,
          customerEmail: request.authenticatedUser?.email ?? '',
          customerName: shipping.name,
          items: lineItems.map(({ stock: _stock, active: _active, ...item }) => item),
          shipping,
          subtotal,
          shippingCost,
          total,
          paymentMethod: 'mercadopago',
          paymentStatus: 'pending',
          status: 'pending_payment',
          inventoryHeld: true,
          expiresAt,
          paymentMode: mercadoPagoMode,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return { subtotal, shippingCost, total, expiresAt, lineItems }
      })
      let preference: { id: string; checkoutUrl: string }
      try {
        preference = await createMercadoPagoPreference(
          orderRef.id,
          email,
          reservation.lineItems,
          reservation.total,
          reservation.expiresAt,
        )
      } catch (error) {
        await releaseOrderInventory(orderRef.id, 'preference_failed', 'payment_failed')
        throw error
      }
      await orderRef.update({
        paymentPreferenceId: preference.id,
        updatedAt: FieldValue.serverTimestamp(),
      })
      response.status(201).json({
        orderId: orderRef.id,
        checkoutUrl: preference.checkoutUrl,
        total: reservation.total,
        expiresAt: reservation.expiresAt.toISOString(),
        paymentMode: mercadoPagoMode,
      })
    } catch (error) {
      if (orderId) {
        try {
          await releaseOrderInventory(orderId, 'preference_failed', 'payment_failed')
        } catch (releaseError) {
          console.error('No se pudo liberar el stock reservado después de un error de pago.', errorCode(releaseError) || 'unknown_error')
        }
      }
      next(error)
    }
  },
)

app.post('/api/payments/mercadopago/webhook', async (request, response) => {
  const notificationType = request.query.type ?? request.query.topic ?? request.body?.type
  if (notificationType !== 'payment') {
    response.status(200).json({ received: true })
    return
  }
  const rawId = request.query['data.id'] ?? request.query.id ?? request.body?.data?.id
  const paymentId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : ''
  if (!/^\d{1,30}$/.test(paymentId) || !isValidMercadoPagoSignature(request, paymentId)) {
    response.status(401).json({ error: 'La notificación de pago no es válida.' })
    return
  }

  try {
    const payment = await getMercadoPagoPayment(paymentId)
    if (
      String(payment.id) !== paymentId ||
      (mercadoPagoMode === 'sandbox' && payment.live_mode !== false) ||
      (mercadoPagoMode === 'production' && payment.live_mode !== true)
    ) {
      response.status(409).json({ error: 'El modo o la identidad del pago no coincide.' })
      return
    }
    await settleMercadoPagoPayment(payment)
    response.status(200).json({ received: true })
  } catch (error) {
    console.error('No se pudo procesar la notificación de Mercado Pago.', errorCode(error) || 'payment_webhook_error')
    response.status(error instanceof ApiError ? error.status : 503).json({
      error: error instanceof ApiError ? error.message : 'No se pudo procesar la notificación de pago.',
    })
  }
})

app.post(
  '/api/orders/:orderId/payment-sync',
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      const orderIdParam = request.params.orderId
      const orderId = typeof orderIdParam === 'string' ? orderIdParam : ''
      const paymentId: unknown = request.body?.paymentId
      if (!uid) throw new ApiError('Iniciá sesión para consultar el pago.', 401)
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) {
        throw new ApiError('El pedido no es válido.', 400)
      }
      if (typeof paymentId !== 'string' || !/^\d{1,30}$/.test(paymentId)) {
        throw new ApiError('El identificador del pago no es válido.', 400)
      }

      const orderRef = firestore.doc(`orders/${orderId}`)
      const order = await orderRef.get()
      if (!order.exists || order.get('userId') !== uid) {
        throw new ApiError('No encontramos el pedido asociado a tu cuenta.', 404)
      }
      if (order.get('paymentStatus') === 'approved') {
        response.json({ message: 'El pago ya está confirmado.' })
        return
      }

      const payment = await getMercadoPagoPayment(paymentId)
      if (
        String(payment.id) !== paymentId ||
        payment.external_reference !== orderId ||
        (mercadoPagoMode === 'sandbox' && payment.live_mode !== false) ||
        (mercadoPagoMode === 'production' && payment.live_mode !== true)
      ) {
        throw new ApiError('Mercado Pago no confirmó un pago válido para este pedido.', 409)
      }

      await settleMercadoPagoPayment(payment)
      response.json({ message: 'Se consultó el estado confirmado por Mercado Pago.' })
    } catch (error) {
      next(error)
    }
  },
)

app.get(
  '/api/orders/:orderId',
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      const orderIdParam = request.params.orderId
      const orderId = typeof orderIdParam === 'string' ? orderIdParam : ''
      if (!uid) throw new ApiError('Iniciá sesión para consultar el pedido.', 401)
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) throw new ApiError('El pedido no es válido.', 400)
      const order = await firestore.doc(`orders/${orderId}`).get()
      if (!order.exists || order.get('userId') !== uid) {
        throw new ApiError('No encontramos ese pedido.', 404)
      }
      const orderData = order.data() ?? {}
      const items = Array.isArray(orderData.items)
        ? orderData.items.flatMap((item) =>
            typeof item === 'object' && item !== null &&
            'id' in item && typeof item.id === 'string' &&
            'quantity' in item && typeof item.quantity === 'number'
              ? [{ id: item.id, quantity: item.quantity }]
              : [],
          )
        : []
      response.json({
        order: {
          id: order.id,
          paymentStatus: orderData.paymentStatus,
          status: orderData.status,
          total: orderData.total,
          items,
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

app.get('/api/reviews/summary', async (_request, response, next) => {
  try {
    const snapshot = await firestore.collection('productReviewSummaries').limit(500).get()
    response.json({
      summaries: Object.fromEntries(snapshot.docs.map((document) => {
        const data = document.data()
        return [document.id, {
          ratingAverage: typeof data.ratingAverage === 'number' ? data.ratingAverage : 0,
          reviewCount: typeof data.reviewCount === 'number' ? data.reviewCount : 0,
        }]
      })),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/products/:productId/reviews', async (request, response, next) => {
  try {
    const productIdParam = request.params.productId
    const productId = typeof productIdParam === 'string' ? productIdParam : ''
    if (!/^[a-z0-9-]{1,80}$/.test(productId)) throw new ApiError('El producto no es válido.', 400)

    const authorization = request.get('authorization')
    let viewerUid = ''
    if (authorization) {
      const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
      if (!token) throw new ApiError('La sesión no es válida.', 401)
      try {
        viewerUid = (await firebaseAuth.verifyIdToken(token)).uid
      } catch {
        throw new ApiError('La sesión venció. Iniciá sesión nuevamente.', 401)
      }
    }
    const ownReviewId = viewerUid ? getProductReviewDocumentId(productId, viewerUid) : ''

    const [reviewsSnapshot, purchaseSnapshot, ownReviewSnapshot, summarySnapshot] = await Promise.all([
      firestore.collection('productReviews')
        .where('productId', '==', productId)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get(),
      viewerUid
        ? firestore.doc(`verifiedPurchases/${viewerUid}_${productId}`).get()
        : Promise.resolve(null),
      viewerUid
        ? firestore.doc(`productReviews/${ownReviewId}`).get()
        : Promise.resolve(null),
      firestore.doc(`productReviewSummaries/${productId}`).get(),
    ])
    const reviews = reviewsSnapshot.docs
      .sort((left, right) => {
        const leftCreatedAt = left.get('createdAt')
        const rightCreatedAt = right.get('createdAt')
        return (rightCreatedAt instanceof Timestamp ? rightCreatedAt.toMillis() : 0) -
          (leftCreatedAt instanceof Timestamp ? leftCreatedAt.toMillis() : 0)
      })
      .map((document) => {
        const data = document.data()
        const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null
        const editedAt = data.editedAt instanceof Timestamp ? data.editedAt.toDate().toISOString() : null
        return {
          rating: data.rating,
          comment: data.comment,
          createdAt,
          editedAt,
          verifiedPurchase: true,
          mine: Boolean(ownReviewId && document.id === ownReviewId),
        }
      })
    const ownReview = ownReviewSnapshot?.exists
      ? (() => {
          const data = ownReviewSnapshot.data() ?? {}
          const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null
          const editedAt = data.editedAt instanceof Timestamp ? data.editedAt.toDate().toISOString() : null
          return {
            rating: data.rating,
            comment: data.comment,
            createdAt,
            editedAt,
            verifiedPurchase: true,
            mine: true,
          }
        })()
      : null
    if (ownReview && !reviews.some((review) => review.mine)) reviews.unshift(ownReview)
    response.json({
      reviews,
      canReview: Boolean(purchaseSnapshot?.exists),
      ownReview,
      summary: {
        ratingAverage: typeof summarySnapshot.get('ratingAverage') === 'number'
          ? summarySnapshot.get('ratingAverage')
          : 0,
        reviewCount: typeof summarySnapshot.get('reviewCount') === 'number'
          ? summarySnapshot.get('reviewCount')
          : 0,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.post(
  '/api/products/:productId/reviews',
  reviewLimiter,
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const productIdParam = request.params.productId
      const productId = typeof productIdParam === 'string' ? productIdParam : ''
      const uid = request.authenticatedUser?.uid
      const rating: unknown = request.body?.rating
      const commentValue: unknown = request.body?.comment
      if (!uid) throw new ApiError('Iniciá sesión para publicar una reseña.', 401)
      if (request.authenticatedUser?.email_verified !== true) {
        throw new ApiError('Verificá tu email antes de publicar una reseña.', 403)
      }
      if (!/^[a-z0-9-]{1,80}$/.test(productId)) throw new ApiError('El producto no es válido.', 400)
      if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new ApiError('Elegí una puntuación entre 1 y 5 estrellas.', 400)
      }
      if (typeof commentValue !== 'string') {
        throw new ApiError('Escribí un comentario antes de publicarlo.', 400)
      }
      const comment = commentValue.trim().replace(/\s+/g, ' ')
      if (comment.length < 10 || comment.length > 1000) {
        throw new ApiError('El comentario debe tener entre 10 y 1000 caracteres.', 400)
      }

      const productSnapshot = await firestore.doc(`products/${productId}`).get()
      const product = getProductSnapshot(
        productSnapshot.exists ? productSnapshot.data() ?? {} : {},
        productId,
      )
      if (!product || !product.active) throw new ApiError('Este producto ya no está disponible para reseñas.', 404)

      const verifiedPurchase = await firestore.doc(`verifiedPurchases/${uid}_${productId}`).get()
      if (!verifiedPurchase.exists) {
        throw new ApiError('Solo pueden opinar quienes completaron una compra de este producto.', 403)
      }

      const reviewRef = firestore.doc(`productReviews/${getProductReviewDocumentId(productId, uid)}`)
      const summaryRef = firestore.doc(`productReviewSummaries/${productId}`)
      const summary = await firestore.runTransaction(async (transaction) => {
        const [reviewSnapshot, summarySnapshot] = await Promise.all([
          transaction.get(reviewRef),
          transaction.get(summaryRef),
        ])
        const previousRating = reviewSnapshot.exists ? reviewSnapshot.get('rating') : null
        const previousCount = summarySnapshot.exists ? summarySnapshot.get('reviewCount') : 0
        const previousAverage = summarySnapshot.exists ? summarySnapshot.get('ratingAverage') : 0
        const previousTotal = summarySnapshot.exists ? summarySnapshot.get('totalRating') : 0
        const reviewCount = typeof previousCount === 'number' ? previousCount : 0
        const averageRating = typeof previousAverage === 'number' ? previousAverage : 0
        const totalRating = typeof previousTotal === 'number'
          ? previousTotal
          : averageRating * reviewCount
        const nextCount = reviewSnapshot.exists
          ? Math.max(reviewCount, 1)
          : reviewCount + 1
        const nextTotal = reviewSnapshot.exists && reviewCount > 0 && typeof previousRating === 'number'
          ? totalRating - previousRating + rating
          : reviewSnapshot.exists
            ? rating
            : totalRating + rating
        const nextAverage = nextTotal / nextCount

        const reviewData = {
          productId,
          rating,
          comment,
          verifiedPurchase: true,
          ...(reviewSnapshot.exists
            ? { editedAt: FieldValue.serverTimestamp() }
            : { createdAt: FieldValue.serverTimestamp() }),
        }
        if (reviewSnapshot.exists) {
          transaction.update(reviewRef, reviewData)
        } else {
          transaction.create(reviewRef, reviewData)
        }
        transaction.set(summaryRef, {
          productId,
          ratingAverage: nextAverage,
          totalRating: nextTotal,
          reviewCount: nextCount,
          updatedAt: FieldValue.serverTimestamp(),
        })
        return {
          ratingAverage: nextAverage,
          reviewCount: nextCount,
        }
      })
      response.status(200).json({
        message: 'Tu reseña verificada quedó guardada.',
        summary,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.get(
  '/api/admin/orders',
  requireFirebaseServices,
  requireUser,
  requireAdmin,
  async (_request, response, next) => {
    try {
      const snapshot = await firestore.collection('orders').orderBy('createdAt', 'desc').limit(50).get()
      response.json({
        orders: snapshot.docs.map((order) => ({ id: order.id, ...order.data() })),
      })
    } catch (error) {
      next(error)
    }
  },
)

app.patch(
  '/api/admin/orders/:orderId',
  requireFirebaseServices,
  requireUser,
  requireAdmin,
  async (request, response, next) => {
    try {
      const orderIdParam = request.params.orderId
      const orderId = typeof orderIdParam === 'string' ? orderIdParam : ''
      const status: unknown = request.body?.status
      const allowedStatuses = ['preparing', 'shipped', 'delivered']
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId) || typeof status !== 'string' || !allowedStatuses.includes(status)) {
        throw new ApiError('El estado del pedido no es válido.', 400)
      }
      const orderRef = firestore.doc(`orders/${orderId}`)
      const order = await orderRef.get()
      if (!order.exists) throw new ApiError('No encontramos ese pedido.', 404)
      if (order.get('paymentStatus') !== 'approved') {
        throw new ApiError('Solo se pueden gestionar pedidos con el pago acreditado.', 409)
      }
      await orderRef.update({ status, updatedAt: FieldValue.serverTimestamp() })
      response.json({ message: 'Se actualizó el estado del pedido.' })
    } catch (error) {
      next(error)
    }
  },
)

if (process.env.NODE_ENV === 'production') {
  const staticDirectory = resolve(process.cwd(), 'dist')
  app.use(express.static(staticDirectory, { index: false }))
  app.get('/{*path}', (request, response, next) => {
    if (request.path.startsWith('/api/')) {
      response.status(404).json({ error: 'No encontramos esa ruta de la API.' })
      return
    }
    response.sendFile(resolve(staticDirectory, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
}

app.use(handleError)

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT debe ser un número de puerto válido.')
}

app.listen(port, '0.0.0.0', () => {
  console.info(`API Lúmina escuchando en http://127.0.0.1:${port}`)
  if (!firebaseConfigured) {
    console.warn('Firebase Admin no está configurado. Revisá FIREBASE_PROJECT_ID y las credenciales ADC.')
  }
  if (!isEmailConfigured()) {
    console.warn('SMTP no está configurado. Revisá las variables SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD y SMTP_FROM.')
  }
  if (firebaseConfigured) {
    const pendingOrderCleanup = setInterval(() => {
      void expirePendingOrders().catch((error: unknown) => {
        console.error('No se pudieron liberar reservas de pedidos vencidos.', errorCode(error) || 'cleanup_error')
      })
    }, 60_000)
    pendingOrderCleanup.unref()
  }
})
