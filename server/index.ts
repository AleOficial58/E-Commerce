import './env.js'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { products as demoProducts } from '../src/data/products.js'
import { getActionCodeSettings, isEmailConfigured, sendActionEmail } from './email.js'

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

const app = express()
app.disable('x-powered-by')
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
    methods: ['GET', 'POST'],
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

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hubo varios intentos de compra. Esperá unos minutos y volvé a probar.' },
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
    if (!admin.exists || admin.get('active') !== true) {
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
  const outcome: unknown = request.body?.outcome
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
  if (outcome !== 'approved' && outcome !== 'declined') {
    throw new ApiError('Elegí una opción válida de pago de prueba.', 400)
  }
  return { items: parsedItems, shipping: parsedShipping, outcome }
}

function getDemoProduct(productId: string) {
  return demoProducts.find((product) => product.id === productId)
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

function requireEmailConfiguration(_request: Request, _response: Response, next: NextFunction) {
  if (!isEmailConfigured()) {
    next(new ApiError('La API todavía no tiene un servidor SMTP configurado.', 503))
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

  const code = errorCode(error)
  if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
    response.status(202).json({
      message: 'Si existe una cuenta con ese email, vas a recibir un correo con los próximos pasos.',
    })
    return
  }

  if (code === 'auth/unauthorized-continue-uri') {
    response.status(503).json({
      error: 'Firebase no autorizó la URL de la tienda. Agregá localhost en Authentication → Settings → Authorized domains y volvé a intentar.',
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

  console.error('Falló una operación de la API de autenticación.', code || 'unknown_error')
  response.status(503).json({
    error: 'No pudimos enviar el correo. Revisá la configuración del servidor e intentá de nuevo.',
  })
}

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    firebaseAdminConfigured: firebaseConfigured,
    smtpConfigured: isEmailConfigured(),
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
      const admin = await firestore.doc(`admins/${uid}`).get()
      response.json({ isAdmin: admin.exists && admin.get('active') === true })
    } catch (error) {
      next(error)
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
  '/api/orders',
  checkoutLimiter,
  requireFirebaseServices,
  requireUser,
  async (request, response, next) => {
    try {
      const uid = request.authenticatedUser?.uid
      if (!uid) throw new ApiError('Iniciá sesión antes de confirmar el pedido.', 401)
      const { items, shipping, outcome } = readCheckoutRequest(request)
      if (outcome === 'declined') {
        response.status(200).json({
          approved: false,
          message: 'El pago de prueba fue rechazado. No se registró ningún pedido.',
        })
        return
      }

      const orderRef = firestore.collection('orders').doc()
      const productRefs = items.map(({ productId }) => firestore.doc(`products/${productId}`))
      const customerProfileRef = firestore.doc(`users/${uid}`)
      const result = await firestore.runTransaction(async (transaction) => {
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
                    rating: getDemoProduct(item.id)?.rating ?? '5.0',
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
          paymentMethod: 'simulated',
          paymentStatus: 'approved_simulated',
          status: 'new',
          demo: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return { subtotal, shippingCost, total }
      })
      response.status(201).json({
        approved: true,
        orderId: orderRef.id,
        ...result,
        message: 'Pago de prueba aprobado. El pedido quedó registrado para la tienda.',
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
})
