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
import { FieldPath, FieldValue, Timestamp, getFirestore, type DocumentReference } from 'firebase-admin/firestore'
import { MAX_ORDER_QUANTITY, products as demoProducts } from '../src/data/products.js'
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
    public readonly code?: string,
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

async function hasAdminAccess(
  uid: string,
  email?: string | null,
  emailVerified?: boolean,
): Promise<boolean> {
  const admin = await firestore.doc(`admins/${uid}`).get()
  if (admin.exists) return admin.get('active') === true
  return isBootstrapAdmin(email, emailVerified)
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
        mediaSrc: ["'self'", 'https:'],
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
    methods: ['DELETE', 'GET', 'POST', 'PATCH'],
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

const reviewMediaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hubo varias cargas de archivos. Esperá unos minutos antes de volver a intentarlo.' },
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
    if (!await hasAdminAccess(
      uid,
      request.authenticatedUser?.email,
      request.authenticatedUser?.email_verified,
    )) {
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
      !('expectedPrice' in item) ||
      !('quantity' in item) ||
      typeof item.productId !== 'string' ||
      !/^[a-z0-9-]{1,80}$/.test(item.productId) ||
      typeof item.expectedPrice !== 'number' ||
      !Number.isSafeInteger(item.expectedPrice) ||
      item.expectedPrice <= 0 ||
      !Number.isInteger(item.quantity) ||
      typeof item.quantity !== 'number' ||
      item.quantity < 1 ||
      item.quantity > MAX_ORDER_QUANTITY
    ) {
      throw new ApiError('El bolso contiene un precio o una cantidad inválida. Actualizá la tienda e intentá de nuevo.', 400)
    }
    return { productId: item.productId, expectedPrice: item.expectedPrice, quantity: item.quantity }
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

const reviewMediaLimits = {
  imageCount: 4,
  imageBytes: 8 * 1024 * 1024,
  videoCount: 1,
  videoBytes: 25 * 1024 * 1024,
  totalCount: 5,
  uploadLifetimeMs: 24 * 60 * 60 * 1000,
}
const cloudinaryNotConfiguredMessage =
  'Las fotos y videos de opiniones no están configurados. La opinión de texto sigue disponible.'
let activeReviewUploads = 0

type CloudinaryConfig = {
  cloudName: string
  apiKey: string
  apiSecret: string
}

function getCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? ''
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim() ?? ''
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() ?? ''
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(cloudName) || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

function requireCloudinaryConfig(): CloudinaryConfig {
  const config = getCloudinaryConfig()
  if (!config) throw new ApiError(cloudinaryNotConfiguredMessage, 503)
  return config
}

function cloudinaryApiSignature(
  params: Record<string, string | number | boolean>,
  apiSecret: string,
): string {
  const canonical = Object.entries(params)
    .filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return createHash('sha1').update(`${canonical}${apiSecret}`).digest('hex')
}

function cloudinaryDeliveryUrl(
  type: 'image' | 'video',
  publicId: string,
  format: string,
): string {
  const { cloudName, apiSecret } = requireCloudinaryConfig()
  const deliveryPath = `${publicId}.${format}`
  const signature = createHash('sha1')
    .update(`${deliveryPath}${apiSecret}`)
    .digest('base64url')
    .slice(0, 8)
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${type}/authenticated/s--${signature}--/${deliveryPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
}

function getStoredMediaDeliveryUrl(data: Record<string, unknown>): string {
  if (
    data.provider !== 'cloudinary' ||
    (data.type !== 'image' && data.type !== 'video') ||
    typeof data.publicId !== 'string' ||
    typeof data.format !== 'string' ||
    !/^reviews\/[a-z0-9-]{1,80}\/[a-f0-9]{64}\/[A-Za-z0-9_-]{1,150}$/.test(data.publicId) ||
    !(data.type === 'video'
      ? data.format === 'mp4'
      : ['jpg', 'jpeg', 'png', 'webp'].includes(data.format))
  ) {
    throw new ApiError('Los metadatos de un archivo de opinión no son válidos.', 409)
  }
  return cloudinaryDeliveryUrl(data.type, data.publicId, data.format)
}

function requireReviewUploadCapacity(_request: Request, response: Response, next: NextFunction) {
  if (activeReviewUploads >= 2) {
    next(new ApiError('Hay varias cargas de archivos en curso. Esperá un momento y volvé a intentar.', 429))
    return
  }
  activeReviewUploads += 1
  let released = false
  const release = () => {
    if (released) return
    released = true
    activeReviewUploads = Math.max(0, activeReviewUploads - 1)
  }
  response.once('finish', release)
  response.once('close', release)
  next()
}

function requireCloudinary(_request: Request, _response: Response, next: NextFunction) {
  try {
    requireCloudinaryConfig()
    next()
  } catch (error) {
    next(error)
  }
}

async function destroyCloudinaryAsset(
  type: 'image' | 'video',
  publicId: string,
): Promise<void> {
  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig()
  const timestamp = Math.floor(Date.now() / 1000)
  const params = { invalidate: true, public_id: publicId, timestamp, type: 'authenticated' }
  const form = new FormData()
  for (const [key, value] of Object.entries(params)) form.append(key, String(value))
  form.append('api_key', apiKey)
  form.append('signature', cloudinaryApiSignature(params, apiSecret))
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${type}/destroy`,
    { method: 'POST', body: form, signal: AbortSignal.timeout(20_000) },
  )
  const result = await response.json().catch(() => null) as
    | { result?: unknown; error?: { message?: unknown } }
    | null
  if (!response.ok && result?.result !== 'not found') {
    throw new ApiError('Cloudinary no pudo eliminar el archivo rechazado. Volvé a intentar.', 502)
  }
  if (response.ok && result?.result !== 'ok' && result?.result !== 'not found') {
    throw new ApiError('Cloudinary no confirmó la eliminación del archivo.', 502)
  }
}

async function cleanupAbandonedReviewUploads() {
  const cutoff = Timestamp.fromMillis(Date.now() - reviewMediaLimits.uploadLifetimeMs)
  const collection = firestore.collection('productReviewMedia')
  const uploadingSnapshot = await collection
    .where('status', '==', 'uploading')
    .limit(100)
    .get()
  const abandonedUploads = uploadingSnapshot.docs.filter((document) => {
    const createdAt = document.get('createdAt')
    return createdAt instanceof Timestamp && createdAt.toMillis() < cutoff.toMillis()
  })
  await Promise.all(abandonedUploads.map(async (document) => {
    const publicId = document.get('publicId')
    const type = document.get('type')
    if (typeof publicId === 'string' && (type === 'image' || type === 'video')) {
      await destroyCloudinaryAsset(type, publicId)
    }
    await document.ref.delete()
  }))
  const rejecting = await collection.where('status', '==', 'rejecting').limit(100).get()
  await Promise.all(rejecting.docs.map(async (document) => {
    const type = document.get('type')
    const publicId = document.get('publicId')
    if ((type !== 'image' && type !== 'video') || typeof publicId !== 'string') {
      throw new ApiError('Un archivo rechazado tiene una referencia no válida.', 409)
    }
    await destroyCloudinaryAsset(type, publicId)
    await document.ref.update({
      status: 'rejected',
      moderatedAt: FieldValue.serverTimestamp(),
    })
  }))
  const deleting = await collection.where('status', '==', 'deleting').limit(100).get()
  await Promise.all(deleting.docs.map(async (document) => {
    const type = document.get('type')
    const publicId = document.get('publicId')
    if ((type !== 'image' && type !== 'video') || typeof publicId !== 'string') {
      throw new ApiError('Un archivo de opinión marcado para eliminar tiene una referencia no válida.', 409)
    }
    await destroyCloudinaryAsset(type, publicId)
    await document.ref.delete()
  }))
}

function parseReviewMediaRequest(
  contentTypeHeader: string,
  file: Buffer,
): {
  type: 'image' | 'video'
  contentType: string
  fileSize: number
} {
  const contentType = contentTypeHeader.toLowerCase().split(';')[0].trim()
  const type = contentType === 'video/mp4' ? 'video' : 'image'
  const isImage = type === 'image' && ['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
  const isVideo = type === 'video' && contentType === 'video/mp4'
  const maxSize = isImage ? reviewMediaLimits.imageBytes : isVideo ? reviewMediaLimits.videoBytes : 0
  if (
    (!isImage && !isVideo) ||
    file.length < 1 ||
    file.length > maxSize
  ) {
    throw new ApiError('Usá imágenes JPEG, PNG o WebP de hasta 8 MB, o un video MP4 de hasta 25 MB.', 400)
  }
  const validSignature =
    contentType === 'image/jpeg'
      ? file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff
      : contentType === 'image/png'
        ? file.length >= 8 && file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : contentType === 'image/webp'
          ? file.length >= 12 && file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP'
          : file.length >= 12 && file.toString('ascii', 4, 8) === 'ftyp'
  if (!validSignature) throw new ApiError('El contenido real del archivo no coincide con el formato declarado.', 400)
  return { type, contentType, fileSize: file.length }
}

function getProductSnapshot(data: Record<string, unknown>, productId: string) {
  const seed = getDemoProduct(productId)
  const name = typeof data.name === 'string' ? data.name : seed?.name
  const category = typeof data.category === 'string' ? data.category : seed?.category
  const description = typeof data.description === 'string' ? data.description : seed?.description
  const image = typeof data.image === 'string' ? data.image : seed?.image
  const price = typeof data.price === 'number' ? data.price : seed?.price
  if (!name || !category || !description || !image || typeof price !== 'number' ||
    !Number.isSafeInteger(price) || price <= 0 || price > 1_000_000_000) return null
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
  payment_type_id?: string
  payment_method_id?: string
  collector_id?: number | string
  application_id?: number | string
  card?: {
    last_four_digits?: string
  }
}

const shipmentTypes = ['local', 'international'] as const
const shipmentStages = [
  'preparing',
  'international_transit',
  'customs',
  'in_argentina',
  'local_transit',
  'out_for_delivery',
  'delivered',
] as const

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
        ...(mercadoPagoMode === 'production' ? { payer: { email: customerEmail } } : {}),
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

async function refundMercadoPagoPayment(paymentId: string, orderId: string) {
  const accessToken = getMercadoPagoAccessToken()
  let response: globalThis.Response
  try {
    response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `cancel-${createHash('sha256').update(orderId).digest('hex').slice(0, 56)}`,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch {
    throw new ApiError('No pudimos confirmar el reembolso. La solicitud quedó pendiente y podés volver a intentar sin duplicarlo.', 502)
  }
  if (!response.ok) {
    console.error('Mercado Pago rechazó la solicitud de reembolso.', {
      orderId,
      paymentId,
      status: response.status,
    })
    throw new ApiError('Mercado Pago no pudo procesar el reembolso. El pedido sigue protegido y podés volver a intentar.', 502)
  }
}

async function findMercadoPagoPaymentId(orderId: string): Promise<string | null> {
  const accessToken = getMercadoPagoAccessToken()
  const url = new URL('https://api.mercadopago.com/v1/payments/search')
  url.searchParams.set('external_reference', orderId)
  url.searchParams.set('sort', 'date_created')
  url.searchParams.set('criteria', 'desc')
  url.searchParams.set('limit', '10')
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    console.error('Mercado Pago no permitió buscar pagos del pedido.', { status: response.status })
    throw new ApiError('No pudimos verificar el pago con Mercado Pago.', 502)
  }

  const result: unknown = await response.json()
  if (typeof result !== 'object' || result === null || !('results' in result) || !Array.isArray(result.results)) {
    throw new ApiError('Mercado Pago devolvió una lista de pagos no válida.', 502)
  }
  const paymentIds = result.results.flatMap((payment: unknown) =>
    typeof payment === 'object' && payment !== null && 'id' in payment &&
    (typeof payment.id === 'number' || typeof payment.id === 'string') &&
    /^\d{1,30}$/.test(String(payment.id))
      ? [String(payment.id)]
      : [],
  )
  return paymentIds[0] ?? null
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
  const now = Timestamp.now()
  const pendingOrders = await firestore.collection('orders')
    .where('status', '==', 'pending_payment')
    .where('expiresAt', '<=', now)
    .orderBy('expiresAt', 'asc')
    .limit(500)
    .get()
  await Promise.all(pendingOrders.docs.map((document) =>
    releaseOrderInventory(document.id, 'expired', 'payment_expired'),
  ))
}

async function settleMercadoPagoPayment(payment: MercadoPagoPayment) {
  const orderId = payment.external_reference
  if (!orderId || !/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) {
    throw new ApiError('El pago no está asociado a un pedido válido.', 400)
  }
  const orderRef = firestore.doc(`orders/${orderId}`)
  let cancellationRefundPaymentId: string | null = null
  await firestore.runTransaction(async (transaction) => {
    cancellationRefundPaymentId = null
    const orderSnapshot = await transaction.get(orderRef)
    if (!orderSnapshot.exists) throw new ApiError('No encontramos el pedido asociado al pago.', 404)
    const order = orderSnapshot.data() ?? {}
    const expectedPaymentMode = order.paymentMode
    const paymentModeMatches =
      (expectedPaymentMode === 'sandbox' && payment.live_mode === false) ||
      (expectedPaymentMode === 'production' && payment.live_mode === true)
    if (!paymentModeMatches) {
      console.warn('El modo del pago no coincide con el modo guardado en el pedido.', {
        orderId,
        paymentId: String(payment.id),
        preferenceId: typeof order.paymentPreferenceId === 'string'
          ? order.paymentPreferenceId
          : null,
        expectedMode: expectedPaymentMode ?? null,
        liveMode: payment.live_mode ?? null,
        paymentStatus: payment.status ?? null,
        paymentTypeId: payment.payment_type_id ?? null,
        paymentMethodId: payment.payment_method_id ?? null,
        collectorId: payment.collector_id ?? null,
        applicationId: payment.application_id ?? null,
        transactionAmount: payment.transaction_amount ?? null,
        currencyId: payment.currency_id ?? null,
      })
      const modeMismatchMessage = expectedPaymentMode === 'sandbox'
        ? payment.live_mode === true
          ? 'Este pedido se creó en modo de prueba, pero Mercado Pago informa que el pago es real. No se confirmó el pedido.'
          : 'Este pedido se creó en modo de prueba, pero Mercado Pago no confirmó que el pago sea de prueba. No se confirmó el pedido.'
        : expectedPaymentMode === 'production'
          ? payment.live_mode === false
            ? 'Este pedido se creó en modo real, pero Mercado Pago informa que el pago es de prueba. No se confirmó el pedido.'
            : 'Este pedido se creó en modo real, pero Mercado Pago no confirmó que el pago sea real. No se confirmó el pedido.'
          : 'El pedido no tiene un modo de pago válido guardado y no se puede confirmar de forma segura.'
      throw new ApiError(modeMismatchMessage, 409)
    }
    if (
      typeof payment.transaction_amount !== 'number' ||
      payment.transaction_amount !== order.total ||
      payment.currency_id !== 'ARS'
    ) {
      throw new ApiError('El importe notificado no coincide con el pedido.', 409)
    }

    const paymentStatus = typeof payment.status === 'string' ? payment.status : 'unknown'
    if (paymentStatus === 'approved') {
      if (order.status === 'cancelled' && order.paymentStatus === 'cancelled') {
        cancellationRefundPaymentId = String(payment.id)
        transaction.update(orderRef, {
          paymentStatus: 'approved',
          paymentId: String(payment.id),
          status: 'cancellation_refund_pending',
          statusHistory: FieldValue.arrayUnion({
            status: 'cancellation_refund_pending',
            detail: 'El pago se acreditó después de cancelar; se solicitó su reembolso.',
            at: Timestamp.now(),
          }),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return
      }
      if (order.paymentStatus === 'approved') {
        if (order.status === 'cancellation_refund_pending') {
          cancellationRefundPaymentId = String(payment.id)
        }
        return
      }
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
        paymentMethodId: payment.payment_method_id ?? null,
        paymentTypeId: payment.payment_type_id ?? null,
        paymentCardLastFourDigits:
          typeof payment.card?.last_four_digits === 'string' &&
          /^\d{4}$/.test(payment.card.last_four_digits)
            ? payment.card.last_four_digits
            : null,
        inventoryHeld: false,
        status: hasInventory ? 'new' : 'payment_review',
        statusHistory: FieldValue.arrayUnion({
          status: hasInventory ? 'new' : 'payment_review',
          at: Timestamp.now(),
        }),
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
          if (paymentStatus === 'refunded' && order.status === 'cancellation_refund_pending') {
            const orderItems = Array.isArray(order.items) ? order.items : []
            const productEntries = orderItems.flatMap((item) =>
              typeof item === 'object' && item !== null &&
              'id' in item && typeof item.id === 'string' &&
              'quantity' in item && typeof item.quantity === 'number' &&
              Number.isInteger(item.quantity) && item.quantity > 0
                ? [{ item, reference: firestore.doc(`products/${item.id}`) }]
                : [],
            )
            const productSnapshots = order.inventoryRestored === true
              ? []
              : await Promise.all(productEntries.map(({ reference }) => transaction.get(reference)))
            if (order.inventoryRestored !== true) {
              productEntries.forEach(({ item, reference }, index) => {
                const stock = productSnapshots[index]?.get('stock')
                if (typeof stock === 'number') {
                  transaction.update(reference, {
                    stock: stock + item.quantity,
                    updatedAt: FieldValue.serverTimestamp(),
                  })
                }
              })
            }
            transaction.update(orderRef, {
              paymentStatus,
              paymentId: String(payment.id),
              status: 'cancelled',
              inventoryHeld: false,
              inventoryRestored: true,
              statusHistory: FieldValue.arrayUnion({
                status: 'cancelled',
                detail: 'Reembolso confirmado por Mercado Pago.',
                at: Timestamp.now(),
              }),
              updatedAt: FieldValue.serverTimestamp(),
            })
          } else {
            transaction.update(orderRef, {
              paymentStatus,
              paymentId: String(payment.id),
              updatedAt: FieldValue.serverTimestamp(),
            })
          }
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
  if (cancellationRefundPaymentId) {
    await refundMercadoPagoPayment(cancellationRefundPaymentId, orderId)
    const refreshedPayment = await getMercadoPagoPayment(cancellationRefundPaymentId)
    if (
      String(refreshedPayment.id) === cancellationRefundPaymentId &&
      refreshedPayment.external_reference === orderId &&
      refreshedPayment.status === 'refunded'
    ) {
      await settleMercadoPagoPayment(refreshedPayment)
    }
  }
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
    response.status(error.status).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    })
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
    const message = error instanceof Error ? error.message : ''
    console.error('Firestore rechazó la operación por una condición pendiente.', {
      code,
      message: message || 'Error sin detalle.',
    })
    if (/requires an index|needs an index|create it here/i.test(message)) {
      response.status(503).json({
        error: 'Firestore necesita un índice para esta consulta. Publicá la configuración con `firebase deploy --only firestore` y volvé a intentar.',
      })
      return
    }
    response.status(503).json({
      error: 'Firestore no pudo completar esta operación por una condición pendiente. Revisá los registros del servidor para conocer el detalle e intentá de nuevo.',
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
  response.set('Cache-Control', 'private, no-store')
  response.json({
    status: 'ok',
    firebaseAdminConfigured: firebaseConfigured,
    reviewMediaConfigured: Boolean(getCloudinaryConfig()),
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
      const bootstrapAdmin = isBootstrapAdmin(
        request.authenticatedUser?.email,
        request.authenticatedUser?.email_verified,
      )
      const isAdmin = await firestore.runTransaction(async (transaction) => {
        const admin = await transaction.get(adminRef)
        if (admin.exists) return admin.get('active') === true
        if (!bootstrapAdmin) return false
        transaction.create(adminRef, {
          email: request.authenticatedUser?.email,
          active: true,
          grantedBy: 'environment-bootstrap',
          grantedAt: FieldValue.serverTimestamp(),
        })
        return true
      })
      response.json({
        isAdmin,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  '/api/admin/self-revoke',
  authenticatedActionLimiter,
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      if (!uid) throw new ApiError('Iniciá sesión para quitar tu acceso de administración.', 401)
      const adminRef = firestore.doc(`admins/${uid}`)
      const bootstrapAdmin = isBootstrapAdmin(
        request.authenticatedUser?.email,
        request.authenticatedUser?.email_verified,
      )
      await firestore.runTransaction(async (transaction) => {
        const admin = await transaction.get(adminRef)
        const hasAccess = admin.exists
          ? admin.get('active') === true
          : bootstrapAdmin
        if (!hasAccess) throw new ApiError('Esta cuenta no tiene permisos de administración.', 403)
        transaction.set(adminRef, {
          email: request.authenticatedUser?.email ?? '',
          active: false,
          revokedBy: uid,
          revokedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })

      response.json({ message: 'Se quitó tu acceso de administración.' })
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
        const lineItems = items.map(({ productId, expectedPrice, quantity }, index) => {
          const snapshot = snapshots[index]
          const data = snapshot?.exists ? snapshot.data() ?? {} : {}
          const product = getProductSnapshot(data, productId)
          if (!product || !product.active) {
            throw new ApiError(`El producto ${productId} ya no está disponible.`, 409)
          }
          if (product.price !== expectedPrice) {
            throw new ApiError(
              `El precio de ${product.name} no coincide con el catálogo vigente. Actualizá la tienda y revisá el total antes de pagar.`,
              409,
              'price_changed',
            )
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
          statusHistory: [{ status: 'pending_payment', at: Timestamp.now() }],
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
  const paymentIdIsValid = /^\d{1,30}$/.test(paymentId)
  const signatureIsValid = paymentIdIsValid && isValidMercadoPagoSignature(request, paymentId)
  if (!signatureIsValid) {
    console.warn('Se rechazó una notificación de Mercado Pago sin una firma válida.', {
      paymentIdIsValid,
      hasSignature: Boolean(request.get('x-signature')),
      hasRequestId: Boolean(request.get('x-request-id')),
    })
    response.status(401).json({ error: 'La notificación de pago no es válida.' })
    return
  }

  try {
    const payment = await getMercadoPagoPayment(paymentId)
    if (String(payment.id) !== paymentId) {
      response.status(409).json({ error: 'Mercado Pago devolvió un identificador de pago distinto al consultado.' })
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
  authenticatedActionLimiter,
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      const orderIdParam = request.params.orderId
      const orderId = typeof orderIdParam === 'string' ? orderIdParam : ''
      const suppliedPaymentId: unknown = request.body?.paymentId
      if (!uid) throw new ApiError('Iniciá sesión para consultar el pedido.', 401)
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) throw new ApiError('El pedido no es válido.', 400)
      if (
        suppliedPaymentId !== undefined &&
        suppliedPaymentId !== '' &&
        (typeof suppliedPaymentId !== 'string' || !/^\d{1,30}$/.test(suppliedPaymentId))
      ) {
        throw new ApiError('El identificador del pago no es válido.', 400)
      }

      const order = await firestore.doc(`orders/${orderId}`).get()
      if (!order.exists || order.get('userId') !== uid) {
        throw new ApiError('No encontramos ese pedido.', 404)
      }

      const paymentId = typeof suppliedPaymentId === 'string' && suppliedPaymentId
        ? suppliedPaymentId
        : await findMercadoPagoPaymentId(orderId)
      if (!paymentId) {
        response.status(200).json({ message: 'Mercado Pago todavía no encontró un pago asociado a este pedido.' })
        return
      }
      const payment = await getMercadoPagoPayment(paymentId)
      if (
        String(payment.id) !== paymentId ||
        payment.external_reference !== orderId
      ) {
        throw new ApiError('El pago no corresponde a este pedido.', 409)
      }
      await settleMercadoPagoPayment(payment)
      response.status(200).json({ message: 'Se verificó el estado del pago con Mercado Pago.' })
    } catch (error) {
      next(error)
    }
  },
)

app.get(
  '/api/orders',
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      if (!uid) throw new ApiError('Iniciá sesión para consultar tus compras.', 401)

      const snapshot = await firestore.collection('orders')
        .where('userId', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      const orders = snapshot.docs.map((document) => {
        const order = document.data()
        if (
          typeof order.paymentStatus !== 'string' ||
          typeof order.status !== 'string' ||
          typeof order.total !== 'number' || !Number.isFinite(order.total) ||
          !Array.isArray(order.items)
        ) {
          throw new ApiError('Los datos de una compra no son válidos.', 500)
        }
        const items = order.items.map((item: unknown) => {
          if (
            typeof item !== 'object' || item === null ||
            !('name' in item) || typeof item.name !== 'string' ||
            !('image' in item) || typeof item.image !== 'string' ||
            !('quantity' in item) || typeof item.quantity !== 'number' ||
            !Number.isInteger(item.quantity)
          ) {
            throw new ApiError('Los productos de una compra no son válidos.', 500)
          }
          return { name: item.name, image: item.image, quantity: item.quantity }
        })
        const createdAt = order.createdAt instanceof Timestamp
          ? order.createdAt.toDate().toISOString()
          : null
        return {
          id: document.id,
          paymentStatus: order.paymentStatus,
          status: order.status,
          total: order.total,
          createdAt,
          shipmentType: order.shipmentType === 'local' || order.shipmentType === 'international'
            ? order.shipmentType
            : null,
          estimatedDeliveryStart: typeof order.estimatedDeliveryStart === 'string'
            ? order.estimatedDeliveryStart
            : null,
          estimatedDeliveryEnd: typeof order.estimatedDeliveryEnd === 'string'
            ? order.estimatedDeliveryEnd
            : null,
          items,
        }
      })
      response.json({ orders })
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  '/api/orders/:orderId/cancel',
  authenticatedActionLimiter,
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      const orderIdParam = request.params.orderId
      const orderId = typeof orderIdParam === 'string' ? orderIdParam : ''
      if (!uid) throw new ApiError('Iniciá sesión para cancelar el pedido.', 401)
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) throw new ApiError('El pedido no es válido.', 400)

      const orderRef = firestore.doc(`orders/${orderId}`)
      const cancellation = await firestore.runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef)
        if (!orderSnapshot.exists || orderSnapshot.get('userId') !== uid) {
          throw new ApiError('No encontramos ese pedido.', 404)
        }
        const order = orderSnapshot.data() ?? {}
        if (order.status === 'cancelled' || order.paymentStatus === 'refunded') {
          return { result: 'cancelled' as const, paymentId: '' }
        }
        if (order.paymentStatus !== 'approved' && order.paymentStatus !== 'pending') {
          throw new ApiError('Este pedido ya no se puede cancelar desde la tienda.', 409)
        }
        if (order.paymentStatus === 'pending' && order.status !== 'pending_payment') {
          throw new ApiError('Este pedido ya no se puede cancelar desde la tienda.', 409)
        }
        const dispatchedStatuses = ['shipped', 'delivered']
        const dispatchedStages = [
          'international_transit',
          'customs',
          'in_argentina',
          'local_transit',
          'out_for_delivery',
          'delivered',
        ]
        if (
          dispatchedStatuses.includes(String(order.status)) ||
          dispatchedStages.includes(String(order.shipmentStage))
        ) {
          throw new ApiError('No se puede cancelar porque el pedido ya fue despachado.', 409)
        }

        if (order.paymentStatus === 'pending') {
          const orderItems = Array.isArray(order.items) ? order.items : []
          const productEntries = orderItems.flatMap((item) =>
            typeof item === 'object' && item !== null &&
            'id' in item && typeof item.id === 'string' &&
            'quantity' in item && typeof item.quantity === 'number' &&
            Number.isInteger(item.quantity) && item.quantity > 0
              ? [{ item, reference: firestore.doc(`products/${item.id}`) }]
              : [],
          )
          const productSnapshots = order.inventoryHeld === true
            ? await Promise.all(productEntries.map(({ reference }) => transaction.get(reference)))
            : []
          if (order.inventoryHeld === true) {
            productEntries.forEach(({ item, reference }, index) => {
              const stock = productSnapshots[index]?.get('stock')
              if (typeof stock === 'number') {
                transaction.update(reference, {
                  stock: stock + item.quantity,
                  updatedAt: FieldValue.serverTimestamp(),
                })
              }
            })
          }
          transaction.update(orderRef, {
            paymentStatus: 'cancelled',
            status: 'cancelled',
            inventoryHeld: false,
            inventoryRestored: true,
            statusHistory: FieldValue.arrayUnion({
              status: 'cancelled',
              detail: 'Cancelado por el cliente antes de acreditar el pago.',
              at: Timestamp.now(),
            }),
            updatedAt: FieldValue.serverTimestamp(),
          })
          return { result: 'cancelled' as const, paymentId: '' }
        }

        if (order.status !== 'cancellation_refund_pending') {
          transaction.update(orderRef, {
            status: 'cancellation_refund_pending',
            statusHistory: FieldValue.arrayUnion({
              status: 'cancellation_refund_pending',
              detail: 'Solicitud de cancelación y reembolso en proceso.',
              at: Timestamp.now(),
            }),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        const paymentId = typeof order.paymentId === 'string' ? order.paymentId : ''
        if (!/^\d{1,30}$/.test(paymentId)) {
          throw new ApiError('No encontramos el pago de Mercado Pago asociado para iniciar el reembolso.', 409)
        }
        return { result: 'refund' as const, paymentId }
      })

      if (cancellation.result === 'cancelled') {
        response.status(200).json({ message: 'La compra fue cancelada.' })
        return
      }

      await refundMercadoPagoPayment(cancellation.paymentId, orderId)
      const payment = await getMercadoPagoPayment(cancellation.paymentId)
      if (
        String(payment.id) !== cancellation.paymentId ||
        payment.external_reference !== orderId
      ) {
        throw new ApiError('No pudimos validar el reembolso con Mercado Pago. La solicitud quedó pendiente para volver a verificar.', 502)
      }
      await settleMercadoPagoPayment(payment)
      const refreshedOrder = await orderRef.get()
      const refunded = refreshedOrder.get('paymentStatus') === 'refunded'
      response.status(refunded ? 200 : 202).json({
        message: refunded
          ? 'La compra fue cancelada y Mercado Pago confirmó el reembolso.'
          : 'La solicitud de reembolso está en proceso. El pedido no se despachará mientras se confirma.',
      })
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
      if (
        !Array.isArray(orderData.items) ||
        typeof orderData.shipping !== 'object' || orderData.shipping === null ||
        typeof orderData.paymentStatus !== 'string' ||
        typeof orderData.status !== 'string' ||
        typeof orderData.subtotal !== 'number' || !Number.isFinite(orderData.subtotal) ||
        typeof orderData.shippingCost !== 'number' || !Number.isFinite(orderData.shippingCost) ||
        typeof orderData.total !== 'number' || !Number.isFinite(orderData.total)
      ) {
        throw new ApiError('Los datos de este pedido no son válidos.', 500)
      }
      const items = orderData.items.map((item: unknown) => {
        if (
          typeof item !== 'object' || item === null ||
          !('id' in item) || typeof item.id !== 'string' ||
          !('name' in item) || typeof item.name !== 'string' ||
          !('image' in item) || typeof item.image !== 'string' ||
          !('price' in item) || typeof item.price !== 'number' || !Number.isFinite(item.price) ||
          !('quantity' in item) || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) ||
          !('lineTotal' in item) || typeof item.lineTotal !== 'number' || !Number.isFinite(item.lineTotal)
        ) {
          throw new ApiError('Los productos de este pedido no son válidos.', 500)
        }
        return {
          id: item.id,
          name: item.name,
          image: item.image,
          price: item.price,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
        }
      })
      const statusHistory = Array.isArray(orderData.statusHistory)
        ? orderData.statusHistory.flatMap((event: unknown) => {
            if (
              typeof event !== 'object' || event === null ||
              !('status' in event) || typeof event.status !== 'string' ||
              !('at' in event) || !(event.at instanceof Timestamp)
            ) return []
            return [{
              status: event.status,
              at: event.at.toDate().toISOString(),
              ...('detail' in event && typeof event.detail === 'string'
                ? { detail: event.detail }
                : {}),
            }]
          })
        : []
      const shipping = orderData.shipping
      if (
        !('name' in shipping) || typeof shipping.name !== 'string' ||
        !('phone' in shipping) || typeof shipping.phone !== 'string' ||
        !('address' in shipping) || typeof shipping.address !== 'string' ||
        !('apartment' in shipping) || typeof shipping.apartment !== 'string' ||
        !('city' in shipping) || typeof shipping.city !== 'string' ||
        !('province' in shipping) || typeof shipping.province !== 'string' ||
        !('postalCode' in shipping) || typeof shipping.postalCode !== 'string'
      ) {
        throw new ApiError('La dirección de entrega de este pedido no es válida.', 500)
      }
      const shippingAddress = {
        name: shipping.name,
        phone: shipping.phone,
        address: shipping.address,
        apartment: shipping.apartment,
        city: shipping.city,
        province: shipping.province,
        postalCode: shipping.postalCode,
      }
      const createdAt = orderData.createdAt instanceof Timestamp
        ? orderData.createdAt.toDate().toISOString()
        : null
      response.json({
        order: {
          id: order.id,
          paymentStatus: orderData.paymentStatus,
          status: orderData.status,
          canCancel: (
            orderData.paymentStatus === 'approved' ||
            (orderData.paymentStatus === 'pending' && orderData.status === 'pending_payment')
          ) &&
            !['shipped', 'delivered', 'cancelled', 'cancellation_refund_pending'].includes(orderData.status) &&
            !['international_transit', 'customs', 'in_argentina', 'local_transit', 'out_for_delivery', 'delivered']
              .includes(String(orderData.shipmentStage)),
          subtotal: orderData.subtotal,
          shippingCost: orderData.shippingCost,
          total: orderData.total,
          createdAt,
          statusHistory,
          paymentMethodId: typeof orderData.paymentMethodId === 'string'
            ? orderData.paymentMethodId
            : null,
          paymentTypeId: typeof orderData.paymentTypeId === 'string'
            ? orderData.paymentTypeId
            : null,
          paymentCardLastFourDigits: typeof orderData.paymentCardLastFourDigits === 'string' &&
            /^\d{4}$/.test(orderData.paymentCardLastFourDigits)
            ? orderData.paymentCardLastFourDigits
            : null,
          shipmentType: orderData.shipmentType === 'local' || orderData.shipmentType === 'international'
            ? orderData.shipmentType
            : null,
          estimatedDeliveryStart: typeof orderData.estimatedDeliveryStart === 'string'
            ? orderData.estimatedDeliveryStart
            : null,
          estimatedDeliveryEnd: typeof orderData.estimatedDeliveryEnd === 'string'
            ? orderData.estimatedDeliveryEnd
            : null,
          shipmentStage: typeof orderData.shipmentStage === 'string' &&
            shipmentStages.includes(orderData.shipmentStage as typeof shipmentStages[number])
            ? orderData.shipmentStage
            : null,
          shipmentStageDetail: typeof orderData.shipmentStageDetail === 'string'
            ? orderData.shipmentStageDetail
            : null,
          trackingCarrier: typeof orderData.trackingCarrier === 'string' ? orderData.trackingCarrier : null,
          trackingCode: typeof orderData.trackingCode === 'string' ? orderData.trackingCode : null,
          trackingUrl: typeof orderData.trackingUrl === 'string' ? orderData.trackingUrl : null,
          shipping: shippingAddress,
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

app.post(
  '/api/products/:productId/reviews/media',
  reviewMediaLimiter,
  requireFirebaseServices,
  requireUser,
  requireCloudinary,
  requireReviewUploadCapacity,
  express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
    limit: '26mb',
  }),
  async (request, response, next) => {
    let mediaRef: DocumentReference | null = null
    let reservedPublicId = ''
    let uploadCompleted = false
    let providerResponseReceived = false
    let reservationCreated = false
    let mediaType: 'image' | 'video' | null = null
    try {
      const productId = typeof request.params.productId === 'string' ? request.params.productId : ''
      const uid = request.authenticatedUser?.uid
      const fileBytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0)
      const { type, contentType, fileSize } = parseReviewMediaRequest(
        request.get('content-type') ?? '',
        fileBytes,
      )
      mediaType = type
      if (!uid) throw new ApiError('Iniciá sesión para adjuntar archivos a tu opinión.', 401)
      if (request.authenticatedUser?.email_verified !== true) {
        throw new ApiError('Verificá tu email antes de adjuntar archivos.', 403)
      }
      if (!/^[a-z0-9-]{1,80}$/.test(productId)) throw new ApiError('El producto no es válido.', 400)
      const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig()

      const reviewId = getProductReviewDocumentId(productId, uid)
      const reviewRef = firestore.doc(`productReviews/${reviewId}`)
      const purchaseRef = firestore.doc(`verifiedPurchases/${uid}_${productId}`)
      const mediaDocumentRef = firestore.collection('productReviewMedia').doc()
      mediaRef = mediaDocumentRef
      const mediaQuery = firestore.collection('productReviewMedia').where('reviewId', '==', reviewId)
      const productRef = firestore.doc(`products/${productId}`)
      const [productSnapshot, purchaseSnapshot] = await Promise.all([
        productRef.get(),
        purchaseRef.get(),
      ])
      const product = getProductSnapshot(
        productSnapshot.exists ? productSnapshot.data() ?? {} : {},
        productId,
      )
      if (!product || !product.active) throw new ApiError('Este producto ya no está disponible para reseñas.', 404)
      if (!purchaseSnapshot.exists) {
        throw new ApiError('Solo pueden adjuntar archivos quienes completaron una compra del producto.', 403)
      }

      await cleanupAbandonedReviewUploads()
      reservedPublicId = `reviews/${productId}/${reviewId}/${mediaDocumentRef.id}`
      await firestore.runTransaction(async (transaction) => {
        const [reviewSnapshot, mediaSnapshot] = await Promise.all([
          transaction.get(reviewRef),
          transaction.get(mediaQuery),
        ])
        if (!reviewSnapshot.exists) {
          throw new ApiError('Publicá primero tu opinión antes de adjuntar archivos.', 409)
        }
        const activeMedia = mediaSnapshot.docs.filter((document) =>
          document.get('status') !== 'rejected',
        )
        const imageCount = activeMedia.filter((document) => document.get('type') === 'image').length
        const videoCount = activeMedia.filter((document) => document.get('type') === 'video').length
        if (
          activeMedia.length >= reviewMediaLimits.totalCount ||
          (type === 'image' && imageCount >= reviewMediaLimits.imageCount) ||
          (type === 'video' && videoCount >= reviewMediaLimits.videoCount)
        ) {
          throw new ApiError('Cada opinión admite hasta 4 imágenes y 1 video.', 409)
        }
        transaction.create(mediaDocumentRef, {
          reviewId,
          productId,
          userId: uid,
          provider: 'cloudinary',
          publicId: reservedPublicId,
          type,
          contentType,
          fileSize,
          status: 'uploading',
          createdAt: FieldValue.serverTimestamp(),
        })
      })
      reservationCreated = true

      const timestamp = Math.floor(Date.now() / 1000)
      const params = { public_id: reservedPublicId, timestamp, type: 'authenticated' }
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(fileBytes)], { type: contentType }), `${mediaDocumentRef.id}`)
      for (const [key, value] of Object.entries(params)) form.append(key, String(value))
      form.append('api_key', apiKey)
      form.append('signature', cloudinaryApiSignature(params, apiSecret))
      const cloudinaryResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${type}/upload`,
        { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) },
      )
      providerResponseReceived = true
      uploadCompleted = cloudinaryResponse.ok
      const cloudinaryResult = await cloudinaryResponse.json().catch(() => null) as
        | {
            public_id?: unknown
            resource_type?: unknown
            type?: unknown
            bytes?: unknown
            format?: unknown
            error?: { message?: unknown }
          }
        | null
      const providerError = typeof cloudinaryResult?.error?.message === 'string'
        ? cloudinaryResult.error.message
        : ''
      if (!cloudinaryResponse.ok) {
        console.error('Cloudinary rechazó un archivo de opinión.', {
          status: cloudinaryResponse.status,
          resourceType: type,
          error: providerError.slice(0, 300) || 'Cloudinary no devolvió un mensaje.',
        })
        if (
          cloudinaryResponse.status === 402 ||
          cloudinaryResponse.status === 420 ||
          /credit|quota|monthly|free plan/i.test(providerError)
        ) {
          throw new ApiError(
            'Cloudinary alcanzó el límite mensual del plan gratuito. La carga de este archivo no se completó; el texto de la opinión no se modifica por este error. Intentá adjuntarlo nuevamente cuando se renueve la cuota.',
            503,
          )
        }
        throw new ApiError('Cloudinary no pudo recibir el archivo. La carga falló sin modificar el texto de la opinión; podés reintentar el adjunto.', 502)
      }
      const expectedFormats = type === 'video' ? ['mp4'] : ['jpg', 'jpeg', 'png', 'webp']
      if (
        cloudinaryResult?.public_id !== reservedPublicId ||
        cloudinaryResult.resource_type !== type ||
        cloudinaryResult.type !== 'authenticated' ||
        cloudinaryResult.bytes !== fileSize ||
        typeof cloudinaryResult.format !== 'string' ||
        !expectedFormats.includes(cloudinaryResult.format)
      ) {
        throw new ApiError('Cloudinary devolvió metadatos que no coinciden con el archivo.', 502)
      }
      const uploadedMediaRef = mediaRef
      if (!uploadedMediaRef) throw new ApiError('No se pudo reservar el archivo para la opinión.', 409)
      await firestore.runTransaction(async (transaction) => {
        const [reviewSnapshot, mediaSnapshot] = await Promise.all([
          transaction.get(reviewRef),
          transaction.get(uploadedMediaRef),
        ])
        if (!reviewSnapshot.exists || !mediaSnapshot.exists || mediaSnapshot.get('status') !== 'uploading') {
          throw new ApiError('La opinión se eliminó o el archivo ya no está disponible.', 409)
        }
        transaction.update(uploadedMediaRef, {
          status: 'pending',
          uploadedAt: FieldValue.serverTimestamp(),
          format: cloudinaryResult.format,
        })
      })
      response.set('Cache-Control', 'private, no-store')
      response.status(201).json({
        media: {
          id: mediaDocumentRef.id,
          type,
          status: 'pending',
          url: '',
          contentType,
          fileSize,
        },
      })
    } catch (error) {
      if (mediaRef && reservationCreated) {
        try {
          if (uploadCompleted && reservedPublicId && mediaType) {
            await destroyCloudinaryAsset(mediaType, reservedPublicId)
          }
          if (providerResponseReceived) await mediaRef.delete()
        } catch {
          // The stale reservation is removed by the bounded cleanup job.
        }
      }
      next(error)
    }
  },
)

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

    const [reviewsSnapshot, purchaseSnapshot, ownReviewSnapshot, summarySnapshot, approvedMediaSnapshot, ownMediaSnapshot] = await Promise.all([
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
      firestore.collection('productReviewMedia')
        .where('productId', '==', productId)
        .where('status', '==', 'approved')
        .limit(250)
        .get(),
      viewerUid && ownReviewId
        ? firestore.collection('productReviewMedia').where('reviewId', '==', ownReviewId).get()
        : Promise.resolve(null),
    ])
    const publicMediaByReview = new Map<string, Record<string, unknown>[]>()
    let mediaError = getCloudinaryConfig() ? '' : cloudinaryNotConfiguredMessage
    approvedMediaSnapshot.docs.forEach((document) => {
      const data = document.data()
      if (
        typeof data.reviewId !== 'string' ||
        (data.type !== 'image' && data.type !== 'video')
      ) return
      let url = ''
      if (getCloudinaryConfig()) {
        try {
          url = getStoredMediaDeliveryUrl(data)
        } catch {
          mediaError = 'No pudimos preparar la vista protegida de algunos archivos adjuntos.'
        }
      }
      const attachments = publicMediaByReview.get(data.reviewId) ?? []
      attachments.push({
        id: document.id,
        type: data.type,
        status: 'approved',
        url,
        contentType: data.contentType,
        fileSize: data.fileSize,
      })
      publicMediaByReview.set(data.reviewId, attachments)
    })
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
          media: publicMediaByReview.get(document.id) ?? [],
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
            media: ownMediaSnapshot?.docs.flatMap((mediaDocument) => {
              const mediaData = mediaDocument.data()
              if (
                (mediaData.type !== 'image' && mediaData.type !== 'video') ||
                !['pending', 'approved'].includes(String(mediaData.status))
              ) return []
              let url = ''
              if (mediaData.status === 'approved' && getCloudinaryConfig()) {
                try {
                  url = getStoredMediaDeliveryUrl(mediaData)
                } catch {
                  mediaError = 'No pudimos preparar la vista protegida de algunos archivos adjuntos.'
                }
              }
              return [{
                id: mediaDocument.id,
                type: mediaData.type,
                status: mediaData.status,
                url,
                contentType: mediaData.contentType,
                fileSize: mediaData.fileSize,
              }]
            }) ?? [],
          }
        })()
      : null
    if (ownReview && !reviews.some((review) => review.mine)) reviews.unshift(ownReview)
      response.set('Cache-Control', 'private, no-store')
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
      ...(mediaError ? { mediaError } : {}),
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
  '/api/admin/product-review-media',
  requireFirebaseServices,
  requireUser,
  requireAdmin,
  requireCloudinary,
  async (request, response, next) => {
    try {
      await cleanupAbandonedReviewUploads()
      const rawCursor = request.query.cursor
      if (rawCursor !== undefined && typeof rawCursor !== 'string') {
        throw new ApiError('El cursor de moderación no es válido.', 400)
      }
      const cursorId = rawCursor ?? ''
      if (cursorId && !/^[A-Za-z0-9_-]{1,150}$/.test(cursorId)) {
        throw new ApiError('El cursor de moderación no es válido.', 400)
      }
      const mediaQuery = firestore.collection('productReviewMedia')
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
      const cursorSnapshot = cursorId
        ? await firestore.doc(`productReviewMedia/${cursorId}`).get()
        : null
      if (cursorId && !cursorSnapshot?.exists) {
        throw new ApiError('La página de moderación venció. Actualizá la lista.', 409)
      }
      const snapshot = await (cursorSnapshot
        ? mediaQuery.startAfter(cursorSnapshot)
        : mediaQuery).limit(26).get()
      const pageDocuments = snapshot.docs.slice(0, 25)
      const media = await Promise.all(pageDocuments.map(async (document) => {
        const data = document.data()
        if (
          typeof data.reviewId !== 'string' ||
          !/^[a-f0-9]{64}$/.test(data.reviewId) ||
          typeof data.productId !== 'string' ||
          !/^[a-z0-9-]{1,80}$/.test(data.productId) ||
          data.provider !== 'cloudinary' ||
          typeof data.publicId !== 'string' ||
          data.publicId !== `reviews/${data.productId}/${data.reviewId}/${document.id}` ||
          (data.type !== 'image' && data.type !== 'video') ||
          typeof data.contentType !== 'string' ||
          typeof data.fileSize !== 'number' ||
          !Number.isSafeInteger(data.fileSize) ||
          typeof data.format !== 'string'
        ) {
          throw new ApiError('Un archivo pendiente tiene metadatos no válidos.', 409)
        }
        const [reviewSnapshot, productSnapshot] = await Promise.all([
          firestore.doc(`productReviews/${data.reviewId}`).get(),
          firestore.doc(`products/${data.productId}`).get(),
        ])
        const review = reviewSnapshot.data() ?? {}
        const product = productSnapshot.data() ?? {}
        const createdAt = data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toISOString()
          : null
        const url = getStoredMediaDeliveryUrl(data)
        return {
          id: document.id,
          reviewId: data.reviewId,
          productId: data.productId,
          productName: typeof product.name === 'string' ? product.name : 'Producto no disponible',
          comment: typeof review.comment === 'string' ? review.comment : '',
          rating: typeof review.rating === 'number' ? review.rating : 0,
          type: data.type,
          contentType: data.contentType,
          fileSize: data.fileSize,
          createdAt,
          url,
        }
      }))
      response.set('Cache-Control', 'private, no-store')
      response.json({
        media,
        nextCursor: snapshot.size > 25 ? pageDocuments[pageDocuments.length - 1]?.id ?? null : null,
        hasMore: snapshot.size > 25,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.patch(
  '/api/admin/product-review-media/:mediaId',
  authenticatedActionLimiter,
  requireFirebaseServices,
  requireUser,
  requireAdmin,
  requireCloudinary,
  async (request, response, next) => {
    try {
      const mediaId = typeof request.params.mediaId === 'string' ? request.params.mediaId : ''
      const action: unknown = request.body?.action
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(mediaId) || (action !== 'approve' && action !== 'reject')) {
        throw new ApiError('La decisión de moderación no es válida.', 400)
      }
      const mediaRef = firestore.doc(`productReviewMedia/${mediaId}`)
      const mediaSnapshot = await mediaRef.get()
      if (!mediaSnapshot.exists || mediaSnapshot.get('status') !== 'pending') {
        throw new ApiError('Este archivo ya fue moderado o no está disponible.', 409)
      }
      const mediaData = mediaSnapshot.data() ?? {}
      if (
        mediaData.provider !== 'cloudinary' ||
        typeof mediaData.publicId !== 'string' ||
        (mediaData.type !== 'image' && mediaData.type !== 'video')
      ) throw new ApiError('La referencia del archivo no es válida.', 409)
      if (action === 'reject') {
        const moderatorUid = request.authenticatedUser?.uid ?? ''
        await firestore.runTransaction(async (transaction) => {
          const current = await transaction.get(mediaRef)
          if (!current.exists || current.get('status') !== 'pending') {
            throw new ApiError('Este archivo ya fue moderado o no está disponible.', 409)
          }
          transaction.update(mediaRef, {
            status: 'rejecting',
            moderatedBy: moderatorUid,
            moderationStartedAt: FieldValue.serverTimestamp(),
          })
        })
        await destroyCloudinaryAsset(mediaData.type, mediaData.publicId)
        await mediaRef.update({
          status: 'rejected',
          moderatedAt: FieldValue.serverTimestamp(),
        })
        response.json({ message: 'Se rechazó y eliminó el archivo.' })
        return
      }
      const moderatorUid = request.authenticatedUser?.uid ?? ''
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(mediaRef)
        if (!current.exists || current.get('status') !== 'pending') {
          throw new ApiError('Este archivo ya fue moderado o no está disponible.', 409)
        }
        getStoredMediaDeliveryUrl(current.data() ?? {})
        transaction.update(mediaRef, {
          status: 'approved',
          moderatedBy: moderatorUid,
          moderatedAt: FieldValue.serverTimestamp(),
        })
      })
      response.json({ message: 'Se aprobó y publicó el archivo en su opinión.' })
    } catch (error) {
      next(error)
    }
  },
)

app.get(
  '/api/admin/product-reviews',
  requireFirebaseServices,
  requireUser,
  requireAdmin,
  async (request, response, next) => {
    try {
      const rawCursor = request.query.cursor
      if (rawCursor !== undefined && typeof rawCursor !== 'string') {
        throw new ApiError('El cursor de opiniones no es válido.', 400)
      }
      let cursor: { seconds: number; nanoseconds: number; id: string } | null = null
      if (rawCursor && rawCursor.length > 512) {
        throw new ApiError('El cursor de opiniones no es válido.', 400)
      }
      if (rawCursor) {
        try {
          const parsed: unknown = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'))
          if (
            typeof parsed !== 'object' || parsed === null ||
            !('seconds' in parsed) || typeof parsed.seconds !== 'number' ||
            !Number.isInteger(parsed.seconds) || parsed.seconds < 0 || parsed.seconds > 253402300799 ||
            !('nanoseconds' in parsed) || typeof parsed.nanoseconds !== 'number' ||
            !Number.isInteger(parsed.nanoseconds) || parsed.nanoseconds < 0 || parsed.nanoseconds > 999999999 ||
            !('id' in parsed) || typeof parsed.id !== 'string' ||
            !/^[a-f0-9]{64}$/.test(parsed.id)
          ) throw new Error('cursor shape')
          cursor = {
            seconds: parsed.seconds,
            nanoseconds: parsed.nanoseconds,
            id: parsed.id,
          }
        } catch {
          throw new ApiError('El cursor de opiniones no es válido.', 400)
        }
      }
      const reviewsQuery = firestore.collection('productReviews')
        .orderBy('createdAt', 'desc')
        .orderBy(FieldPath.documentId(), 'desc')
      const snapshot = await (cursor
        ? reviewsQuery.startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id)
        : reviewsQuery).limit(26).get()
      const pageDocuments = snapshot.docs.slice(0, 25)
      const productIds = [...new Set(pageDocuments.flatMap((document) => {
        const productId = document.get('productId')
        return typeof productId === 'string' ? [productId] : []
      }))]
      const productSnapshots = await Promise.all(productIds.map((productId) =>
        firestore.doc(`products/${productId}`).get(),
      ))
      const productNames = new Map(productIds.map((productId, index) => {
        const productSnapshot = productSnapshots[index]
        const product = getProductSnapshot(
          productSnapshot?.exists ? productSnapshot.data() ?? {} : {},
          productId,
        )
        return [productId, product?.name ?? 'Producto no disponible']
      }))
      const reviews = pageDocuments.map((document) => {
        const data = document.data()
        const productId = typeof data.productId === 'string' ? data.productId : ''
        const createdAt = data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toISOString()
          : null
        return {
          id: document.id,
          productId,
          productName: productNames.get(productId) ?? 'Producto no disponible',
          rating: typeof data.rating === 'number' ? data.rating : 0,
          comment: typeof data.comment === 'string' ? data.comment : '',
          createdAt,
        }
      })
      response.set('Cache-Control', 'private, no-store')
      const lastReview = pageDocuments[pageDocuments.length - 1]
      const lastCreatedAt = lastReview?.get('createdAt')
      const nextCursor = snapshot.size > 25 && lastReview && lastCreatedAt instanceof Timestamp
        ? Buffer.from(JSON.stringify({
            seconds: lastCreatedAt.seconds,
            nanoseconds: lastCreatedAt.nanoseconds,
            id: lastReview.id,
          })).toString('base64url')
        : null
      response.json({
        reviews,
        nextCursor,
        hasMore: nextCursor !== null,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.delete(
  '/api/admin/product-reviews/:reviewId',
  authenticatedActionLimiter,
  requireFirebaseServices,
  requireUser,
  requireAdmin,
  async (request, response, next) => {
    try {
      const reviewId = typeof request.params.reviewId === 'string' ? request.params.reviewId : ''
      if (!/^[a-f0-9]{64}$/.test(reviewId)) {
        throw new ApiError('La opinión seleccionada no es válida.', 400)
      }
      const reviewRef = firestore.doc(`productReviews/${reviewId}`)
      const result = await firestore.runTransaction(async (transaction) => {
        const reviewSnapshot = await transaction.get(reviewRef)
        if (!reviewSnapshot.exists) throw new ApiError('La opinión ya no existe.', 404)
        const reviewData = reviewSnapshot.data() ?? {}
        const productId = typeof reviewData.productId === 'string' ? reviewData.productId : ''
        const rating = reviewData.rating
        if (!/^[a-z0-9-]{1,80}$/.test(productId) ||
          typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5
        ) {
          throw new ApiError('Los datos de la opinión no son válidos para eliminarla.', 409)
        }
        const summaryRef = firestore.doc(`productReviewSummaries/${productId}`)
        const mediaQuery = firestore.collection('productReviewMedia').where('reviewId', '==', reviewId)
        const [summarySnapshot, mediaSnapshot] = await Promise.all([
          transaction.get(summaryRef),
          transaction.get(mediaQuery),
        ])
        for (const mediaDocument of mediaSnapshot.docs) {
          const mediaData = mediaDocument.data()
          if (
            mediaData.provider !== 'cloudinary' ||
            (mediaData.type !== 'image' && mediaData.type !== 'video') ||
            mediaData.publicId !== `reviews/${productId}/${reviewId}/${mediaDocument.id}`
          ) {
            throw new ApiError('La opinión tiene un archivo adjunto con referencia no válida.', 409)
          }
        }

        const reviewCount = summarySnapshot.get('reviewCount')
        const ratingAverage = summarySnapshot.get('ratingAverage')
        const totalRating = summarySnapshot.get('totalRating')
        const previousCount = typeof reviewCount === 'number' ? reviewCount : 0
        const previousAverage = typeof ratingAverage === 'number' ? ratingAverage : 0
        const previousTotal = typeof totalRating === 'number'
          ? totalRating
          : previousAverage * previousCount
        const nextCount = Math.max(0, previousCount - 1)
        const nextTotal = Math.max(0, previousTotal - rating)
        const summary = {
          ratingAverage: nextCount > 0 ? nextTotal / nextCount : 0,
          reviewCount: nextCount,
        }
        transaction.delete(reviewRef)
        if (summarySnapshot.exists && nextCount > 0) {
          transaction.update(summaryRef, {
            ratingAverage: summary.ratingAverage,
            totalRating: nextTotal,
            reviewCount: nextCount,
            updatedAt: FieldValue.serverTimestamp(),
          })
        } else if (summarySnapshot.exists) {
          transaction.delete(summaryRef)
        }
        for (const mediaDocument of mediaSnapshot.docs) {
          transaction.update(mediaDocument.ref, {
            status: 'deleting',
            moderatedAt: FieldValue.serverTimestamp(),
          })
        }
        return { productId, summary }
      })

      let cleanupPending = false
      try {
        await cleanupAbandonedReviewUploads()
      } catch (error) {
        cleanupPending = true
        console.error('La opinión se eliminó, pero no se pudieron borrar todos sus adjuntos.', {
          reviewId,
          error: error instanceof Error ? error.message : 'Error desconocido.',
        })
      }
      response.json({
        message: cleanupPending
          ? 'Se eliminó la opinión. Algunos archivos quedaron pendientes de eliminación y se reintentará su limpieza.'
          : 'Se eliminó la opinión publicada y sus archivos adjuntos.',
        productId: result.productId,
        summary: result.summary,
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
      const hasShipmentUpdate = request.body?.shipmentType !== undefined
      if (
        !/^[A-Za-z0-9_-]{1,150}$/.test(orderId) ||
        (status !== undefined && (typeof status !== 'string' || !allowedStatuses.includes(status))) ||
        (status === undefined && !hasShipmentUpdate)
      ) {
        throw new ApiError('La actualización del pedido no es válida.', 400)
      }
      const orderRef = firestore.doc(`orders/${orderId}`)
      const order = await orderRef.get()
      if (!order.exists) throw new ApiError('No encontramos ese pedido.', 404)
      if (order.get('paymentStatus') !== 'approved') {
        throw new ApiError('Solo se pueden gestionar pedidos con el pago acreditado.', 409)
      }
      const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
      const historyEvents: { status: string; at: Timestamp; detail?: string }[] = []
      if (typeof status === 'string') {
        updates.status = status
        const stage = status === 'preparing'
          ? 'preparing'
          : status === 'delivered'
            ? 'delivered'
            : order.get('shipmentType') === 'international'
              ? 'international_transit'
              : 'local_transit'
        updates.shipmentStage = stage
        updates.shipmentStageDetail = ''
        historyEvents.push({ status, at: Timestamp.now() }, { status: stage, at: Timestamp.now() })
      }
      if (hasShipmentUpdate) {
        const {
          shipmentType,
          estimatedDeliveryStart,
          estimatedDeliveryEnd,
          shipmentStage,
          shipmentStageDetail,
          trackingCarrier,
          trackingCode,
          trackingUrl,
        } = request.body ?? {}
        const datePattern = /^\d{4}-\d{2}-\d{2}$/
        const validDate = (value: unknown) =>
          typeof value === 'string' &&
          datePattern.test(value) &&
          Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
          new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
        const validStageForShipment = shipmentType === 'international'
          ? (shipmentStages as readonly unknown[]).includes(shipmentStage)
          : ['preparing', 'local_transit', 'out_for_delivery', 'delivered'].includes(String(shipmentStage))
        if (
          !(shipmentTypes as readonly unknown[]).includes(shipmentType) ||
          !validStageForShipment ||
          !validDate(estimatedDeliveryStart) ||
          !validDate(estimatedDeliveryEnd) ||
          estimatedDeliveryStart > estimatedDeliveryEnd ||
          typeof shipmentStageDetail !== 'string' || shipmentStageDetail.length > 240 ||
          typeof trackingCarrier !== 'string' || trackingCarrier.length > 80 ||
          typeof trackingCode !== 'string' || trackingCode.length > 80 ||
          typeof trackingUrl !== 'string' || trackingUrl.length > 500
        ) {
          throw new ApiError('Revisá tipo de envío, etapa, fechas y datos de seguimiento.', 400)
        }
        if (trackingUrl) {
          let parsedTrackingUrl: URL
          try {
            parsedTrackingUrl = new URL(trackingUrl)
          } catch {
            throw new ApiError('El enlace de seguimiento no es válido.', 400)
          }
          if (
            parsedTrackingUrl.protocol !== 'https:' ||
            parsedTrackingUrl.username ||
            parsedTrackingUrl.password
          ) {
            throw new ApiError('El enlace de seguimiento debe usar HTTPS.', 400)
          }
        }
        updates.shipmentType = shipmentType
        updates.estimatedDeliveryStart = estimatedDeliveryStart
        updates.estimatedDeliveryEnd = estimatedDeliveryEnd
        updates.shipmentStage = shipmentStage
        updates.shipmentStageDetail = shipmentStageDetail.trim()
        updates.trackingCarrier = trackingCarrier.trim()
        updates.trackingCode = trackingCode.trim()
        updates.trackingUrl = trackingUrl.trim()
        const fulfillmentStatus = shipmentStage === 'delivered'
          ? 'delivered'
          : shipmentStage === 'preparing'
            ? 'preparing'
            : 'shipped'
        updates.status = fulfillmentStatus
        historyEvents.push(
          {
            status: fulfillmentStatus,
            at: Timestamp.now(),
          },
          {
            status: shipmentStage,
            detail: shipmentStageDetail.trim(),
            at: Timestamp.now(),
          },
        )
      }
      await firestore.runTransaction(async (transaction) => {
        const latestOrder = await transaction.get(orderRef)
        if (!latestOrder.exists) throw new ApiError('No encontramos ese pedido.', 404)
        if (latestOrder.get('paymentStatus') !== 'approved') {
          throw new ApiError('Solo se pueden gestionar pedidos con el pago acreditado.', 409)
        }
        if (
          latestOrder.get('status') === 'cancellation_refund_pending' ||
          latestOrder.get('status') === 'cancelled' ||
          latestOrder.get('paymentStatus') === 'refunded'
        ) {
          throw new ApiError('No se puede despachar un pedido que está siendo cancelado o ya fue cancelado.', 409)
        }
        const latestStatus = latestOrder.get('status')
        if (typeof status === 'string') {
          const nextStatus = hasShipmentUpdate ? updates.status : status
          if (hasShipmentUpdate && nextStatus !== status) {
            throw new ApiError('El estado y la etapa de envío no coinciden.', 400)
          }
          const allowedNextStatus =
            (latestStatus === 'new' && nextStatus === 'preparing') ||
            (latestStatus === 'preparing' && nextStatus === 'shipped') ||
            (latestStatus === 'shipped' && nextStatus === 'delivered')
          if (!allowedNextStatus) {
            throw new ApiError('El estado del pedido cambió. Actualizá la lista antes de volver a intentarlo.', 409)
          }
          if (!hasShipmentUpdate) {
            const latestShipmentType = latestOrder.get('shipmentType')
            const nextStage = status === 'preparing'
              ? 'preparing'
              : status === 'delivered'
                ? 'delivered'
                : latestShipmentType === 'international'
                  ? 'international_transit'
                  : 'local_transit'
            updates.shipmentStage = nextStage
            updates.shipmentStageDetail = ''
            if (historyEvents.length > 1) {
              historyEvents[1] = { status: nextStage, at: Timestamp.now() }
            }
          }
        }
        if (hasShipmentUpdate) {
          const currentStage = latestOrder.get('shipmentStage')
          const currentStageIndex = typeof currentStage === 'string'
            ? shipmentStages.indexOf(currentStage as typeof shipmentStages[number])
            : -1
          const previousStage = currentStageIndex >= 0
            ? currentStageIndex
            : latestStatus === 'delivered'
              ? shipmentStages.indexOf('delivered')
              : latestStatus === 'shipped'
                ? shipmentStages.indexOf(
                    latestOrder.get('shipmentType') === 'international'
                      ? 'international_transit'
                      : 'local_transit',
                  )
                : 0
          const nextStage = shipmentStages.indexOf(
            request.body.shipmentStage as typeof shipmentStages[number],
          )
          if (nextStage < previousStage) {
            throw new ApiError('La etapa del envío no puede retroceder. Revisá el seguimiento e intentá de nuevo.', 409)
          }
        }
        if (historyEvents.length > 0) {
          updates.statusHistory = FieldValue.arrayUnion(...historyEvents)
        }
        transaction.update(orderRef, updates)
      })
      response.json({ message: 'Se actualizó el estado del pedido.' })
    } catch (error) {
      next(error)
    }
  },
)

async function getOrderMessageAccess(request: Request, orderId: string) {
  const uid = request.authenticatedUser?.uid
  if (!uid) throw new ApiError('Iniciá sesión para consultar los mensajes.', 401)
  const orderSnapshot = await firestore.doc(`orders/${orderId}`).get()
  if (!orderSnapshot.exists) throw new ApiError('No encontramos ese pedido.', 404)
  const isAdmin = await hasAdminAccess(
    uid,
    request.authenticatedUser?.email,
    request.authenticatedUser?.email_verified,
  )
  if (!isAdmin && orderSnapshot.get('userId') !== uid) {
    throw new ApiError('No encontramos ese pedido.', 404)
  }
  return { uid, isAdmin, order: orderSnapshot.data() ?? {} }
}

app.get(
  '/api/orders/:orderId/messages',
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const orderId = typeof request.params.orderId === 'string' ? request.params.orderId : ''
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) throw new ApiError('El pedido no es válido.', 400)
      await getOrderMessageAccess(request, orderId)
      const snapshot = await firestore.collection(`orders/${orderId}/messages`)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get()
      const messages = snapshot.docs.reverse().map((document) => {
        const data = document.data()
        if (
          (data.authorRole !== 'customer' && data.authorRole !== 'admin') ||
          typeof data.authorName !== 'string' ||
          typeof data.body !== 'string'
        ) throw new ApiError('Un mensaje del pedido tiene datos no válidos.', 500)
        return {
          id: document.id,
          authorRole: data.authorRole,
          authorName: data.authorName,
          body: data.body,
          createdAt: data.createdAt instanceof Timestamp
            ? data.createdAt.toDate().toISOString()
            : null,
        }
      })
      response.json({ messages })
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  '/api/orders/:orderId/messages',
  authenticatedActionLimiter,
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const orderId = typeof request.params.orderId === 'string' ? request.params.orderId : ''
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) throw new ApiError('El pedido no es válido.', 400)
      const { uid, isAdmin, order } = await getOrderMessageAccess(request, orderId)
      const body = request.body?.body
      if (typeof body !== 'string' || !body.trim() || body.trim().length > 2000) {
        throw new ApiError('El mensaje debe tener entre 1 y 2000 caracteres.', 400)
      }
      await firestore.collection(`orders/${orderId}/messages`).add({
        authorUid: uid,
        authorRole: isAdmin ? 'admin' : 'customer',
        authorName: isAdmin
          ? 'Equipo Lúmina'
          : typeof order.customerName === 'string'
            ? order.customerName
            : 'Cliente',
        body: body.trim(),
        createdAt: FieldValue.serverTimestamp(),
      })
      response.status(201).json({ message: 'Se envió tu mensaje.' })
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
