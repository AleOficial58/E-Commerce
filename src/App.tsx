import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { User } from 'firebase/auth'
import type { SweetAlertOptions } from 'sweetalert2'
import { firebaseReady, getFirebaseServices } from './lib/firebase'
import {
  loadAndMergeUserStore,
  readGuestStore,
  saveGuestStore,
  saveUserStore,
  type UserStore,
} from './lib/userStore'
import {
  requestPasswordResetEmail,
  requestVerificationEmail,
} from './lib/emailApi'
import { MAX_ORDER_QUANTITY, products, type Product, type ProductAttribute } from './data/products'
import {
  checkAdminAccess,
  cancelCustomerOrder,
  createCheckoutPreference,
  CommerceApiError,
  loadCustomerOrder,
  grantAdminAccess,
  loadAdminOrders,
  loadCustomerOrders,
  pollCustomerOrder,
  revokeOwnAdminAccess,
  updateAdminShipment,
  updateAdminOrderStatus,
  type AdminOrder,
  type AdminShipmentUpdate,
  type CustomerOrderStatus,
  type CustomerOrderSummary,
  type ShippingAddress,
} from './lib/commerceApi'
import {
  loadProductReviews,
  loadPendingReviewMedia,
  loadAdminProductReviews,
  deleteAdminProductReview,
  loadReviewSummaries,
  moderatePendingReviewMedia,
  saveProductReview,
  uploadProductReviewMedia,
  type PendingReviewMedia,
  type AdminProductReview,
  type ReviewMedia,
  type ProductReviewsResult,
  type ReviewSummary,
} from './lib/reviewsApi'
import { loadAdminWishlistCounts, uploadAdminProductImage } from './lib/adminProductApi'
import { AuthActionPage } from './components/AuthActionPage'
import { CustomerOrdersPage } from './components/CustomerOrdersPage'
import { OrderStatusPage } from './components/OrderStatusPage'
import { OrderMessages } from './components/OrderMessages'
import { NotificationCenter } from './components/NotificationCenter'
import { useNotificationStore } from './lib/notificationStore'
import { ThemeToggleButton } from './lib/theme'
import './App.css'

async function showConfirmation(options: SweetAlertOptions) {
  const [{ default: Swal }] = await Promise.all([
    import('sweetalert2'),
    import('sweetalert2/dist/sweetalert2.min.css'),
  ])
  return Swal.fire(options)
}

type IconName =
  | 'arrow'
  | 'bag'
  | 'box'
  | 'check'
  | 'close'
  | 'heart'
  | 'lock'
  | 'minus'
  | 'plus'
  | 'search'
  | 'settings'
  | 'sparkles'
  | 'user'

const emptyReviewSummary: ReviewSummary = { ratingAverage: 0, reviewCount: 0 }

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  switch (name) {
    case 'arrow':
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'bag':
      return <svg {...common}><path d="M5 8h14l1 13H4L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>
    case 'box':
      return <svg {...common}><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" /><path d="m3 7 9 4 9-4M12 11v10M7.5 5l9 4" /></svg>
    case 'check':
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>
    case 'heart':
      return <svg {...common}><path d="M20.8 8.7c0 4.1-8.8 10-8.8 10s-8.8-5.9-8.8-10A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.8 2.3Z" /></svg>
    case 'lock':
      return <svg {...common}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></svg>
    case 'minus':
      return <svg {...common}><path d="M5 12h14" /></svg>
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
    case 'search':
      return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></svg>
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V4a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></svg>
    case 'sparkles':
      return <svg {...common}><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3ZM19 14l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" /></svg>
    case 'user':
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
  }
}

function getAccountAvatar(seed: string): string {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619)
  }
  const variant = hash >>> 0
  const backgrounds = [
    ['#f5c5bd', '#f5e1bd'],
    ['#c4d7e8', '#e3cce7'],
    ['#c8dfd2', '#f1d5bb'],
    ['#ddd0ed', '#f3cbd5'],
  ]
  const skins = ['#f2c7a5', '#d99b73', '#f4d7b7', '#bb805e']
  const hairColors = ['#382b33', '#5b3831', '#272733', '#8b563e']
  const clothes = ['#815d75', '#496c72', '#a86469', '#59658b']
  const palette = backgrounds[variant % backgrounds.length]
  const skin = skins[(variant >>> 3) % skins.length]
  const hair = hairColors[(variant >>> 6) % hairColors.length]
  const clothing = clothes[(variant >>> 9) % clothes.length]
  const hairstyles = [
    'M26 49c-5-27 10-39 27-39 21 0 31 15 25 42l-7-12c-9-2-19-7-25-14-4 9-10 15-20 18Z',
    'M24 48C19 21 32 10 51 10c22 0 30 17 24 40l-9-11c-4-14-17-18-29-13l-7 23Z',
    'M23 48c-5-24 8-39 29-39 20 0 31 16 25 42l-9-13c-13 0-20-5-26-13-5 10-10 17-19 23Z',
  ]
  const hairShape = hairstyles[(variant >>> 12) % hairstyles.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient></defs><rect width="100" height="100" rx="50" fill="url(#bg)"/><circle cx="17" cy="28" r="3" fill="#fff" opacity=".65"/><circle cx="82" cy="24" r="2" fill="#fff" opacity=".8"/><path d="M17 100c2-21 15-31 33-31s31 10 33 31" fill="${clothing}"/><path d="M39 64h22v17H39z" fill="${skin}"/><ellipse cx="50" cy="45" rx="24" ry="28" fill="${skin}"/><path d="${hairShape}" fill="${hair}"/><circle cx="41" cy="48" r="1.8" fill="#392b2d"/><circle cx="59" cy="48" r="1.8" fill="#392b2d"/><path d="M45 59c3 3 7 3 10 0" fill="none" stroke="#a65e61" stroke-width="2" stroke-linecap="round"/><path d="M34 42c3-3 7-4 11-2m10 0c4-2 8-1 11 2" fill="none" stroke="${hair}" stroke-width="3" stroke-linecap="round"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const defaultCategories = ['Accesorios', 'Bijou', 'Bolsos', 'Cabello']
type ProductSort = 'recommended' | 'price-asc' | 'price-desc' | 'rating' | 'newest'
const isProductSort = (value: string): value is ProductSort =>
  ['recommended', 'price-asc', 'price-desc', 'rating', 'newest'].includes(value)
const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

function getOrderStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: 'Compra confirmada',
    preparing: 'En preparación',
    shipped: 'En camino',
    delivered: 'Entregada',
    payment_review: 'Pago en revisión',
    payment_failed: 'Pago no completado',
    payment_expired: 'Pago vencido',
    cancellation_refund_pending: 'Reembolso en proceso',
    cancelled: 'Compra cancelada',
  }
  return labels[status] ?? 'Estado actualizado'
}

function getShipmentStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    preparing: 'En preparación',
    international_transit: 'En camino desde el exterior',
    customs: 'En aduana',
    in_argentina: 'En Argentina',
    local_transit: 'En camino a tu domicilio',
    out_for_delivery: 'En reparto',
    delivered: 'Entregada',
  }
  return labels[stage] ?? 'Tu envío tiene una novedad'
}

const heroSlides = [
  {
    image: 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1200&q=85',
    alt: 'Aros dorados y accesorios de la colección Lúmina',
    caption: 'Pequeños detalles, grandes momentos',
  },
  {
    image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1200&q=85',
    alt: 'Bolsos de tonos suaves para todos los días',
    caption: 'Un favorito para llevar a todas partes',
  },
  {
    image: 'https://images.unsplash.com/photo-1590548784585-643d2b9f2925?auto=format&fit=crop&w=1200&q=85',
    alt: 'Accesorios para crear peinados con personalidad',
    caption: 'Tu estilo también vive en los detalles',
  },
]

const announcementMessages = [
  'Reseñas habilitadas para compras verificadas',
  'Consultá el detalle y el total antes de continuar',
  'Tus opiniones ayudan a comprar con más información',
]

function getErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : ''
}

function getAuthErrorMessage(error: unknown): string {
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'Ese email ya tiene una cuenta. Iniciá sesión o recuperá tu contraseña.',
    'auth/invalid-credential': 'El email o la contraseña no coinciden.',
    'auth/invalid-email': 'Revisá el formato del email.',
    'auth/invalid-api-key': 'La clave de Firebase no es válida. Revisá la configuración de la app web.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/network-request-failed': 'No pudimos conectar. Revisá tu conexión.',
    'auth/operation-not-allowed': 'Email y contraseña no están habilitados en Firebase Authentication.',
    'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase Authentication. Agregá el dominio actual de la tienda en Dominios autorizados.',
    'auth/too-many-requests': 'Hubo muchos intentos. Esperá un momento y volvé a probar.',
    'auth/user-disabled': 'Esta cuenta está deshabilitada. Contactá con soporte.',
    'auth/user-not-found': 'No encontramos una cuenta con ese email.',
    'auth/wrong-password': 'La contraseña no coincide. Podés recuperar el acceso desde acá.',
  }
  return messages[getErrorCode(error)] ?? 'No pudimos completar la solicitud. Revisá la configuración de Firebase e intentá de nuevo.'
}

function getProfileErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'Tu sesión está activa, pero Firestore rechazó el perfil. Revisá que hayas publicado firestore.rules en el proyecto correcto.'
  }
  if (code === 'unavailable' || code === 'firestore/unavailable') {
    return 'Tu sesión está activa, pero Firestore no está disponible. Revisá tu conexión e intentá de nuevo.'
  }
  return 'Tu sesión está activa, pero no pudimos cargar el perfil de Firestore. Revisá las reglas de la base.'
}

function getEmailRequestError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'No pudimos enviar el correo. Revisá la configuración de la API e intentá de nuevo.'
}

type CustomerProfile = {
  name: string
  phone: string
  address: string
  apartment: string
  city: string
  province: string
  postalCode: string
}

const emptyCustomerProfile: CustomerProfile = {
  name: '',
  phone: '',
  address: '',
  apartment: '',
  city: '',
  province: '',
  postalCode: '',
}

function getPaymentReturnParams(): { orderId: string; paymentId: string } {
  const currentUrl = new URL(window.location.href)
  const orderId =
    currentUrl.searchParams.get('order_id') ??
    currentUrl.searchParams.get('external_reference') ??
    ''
  const paymentId =
    currentUrl.searchParams.get('payment_id') ??
    currentUrl.searchParams.get('collection_id') ??
    ''
  const isPaymentReturn =
    currentUrl.searchParams.get('payment') === 'return' ||
    Boolean(orderId) ||
    Boolean(paymentId)

  return isPaymentReturn ? { orderId, paymentId } : { orderId: '', paymentId: '' }
}

const profileCompletionFields: (keyof CustomerProfile)[] = [
  'name',
  'phone',
  'address',
  'city',
  'province',
  'postalCode',
]

type AdminProductDraft = {
  id: string
  name: string
  category: string
  description: string
  price: string
  originalPrice: string
  stock: string
  image: string
  galleryImages: string
  characteristics: ProductAttribute[]
  specifications: ProductAttribute[]
}

const emptyAdminProductDraft: AdminProductDraft = {
  id: '',
  name: '',
  category: 'Bijou',
  description: '',
  price: '',
  originalPrice: '',
  stock: '10',
  image: '',
  galleryImages: '',
  characteristics: [],
  specifications: [],
}

function getAdminProductImages(draft: Pick<AdminProductDraft, 'image' | 'galleryImages'>): string[] {
  return Array.from(new Set([
    draft.image.trim(),
    ...draft.galleryImages.split(/\r?\n/).map((url) => url.trim()),
  ].filter(Boolean)))
}

function readProductAttributes(value: unknown): ProductAttribute[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('label' in item) ||
      !('value' in item) ||
      typeof item.label !== 'string' ||
      typeof item.value !== 'string' ||
      !item.label.trim() ||
      !item.value.trim() ||
      item.label.length > 60 ||
      item.value.length > 300
    ) return []
    return [{ label: item.label, value: item.value }]
  }).slice(0, 30)
}

function getProductRouteId(): string {
  const match = window.location.pathname.match(/^\/producto\/([^/]+)\/?$/)
  return match?.[1] ?? ''
}

type AdminAccessibilitySettings = {
  textScale: 'normal' | 'large' | 'largest'
  highContrast: boolean
  reduceMotion: boolean
  visibleFocus: boolean
  compactLayout: boolean
}

const defaultAdminAccessibility: AdminAccessibilitySettings = {
  textScale: 'normal',
  highContrast: false,
  reduceMotion: false,
  visibleFocus: true,
  compactLayout: false,
}

function readAdminAccessibilitySettings(): AdminAccessibilitySettings {
  const systemPrefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  try {
    const stored = window.localStorage.getItem('lumina:admin-accessibility')
    if (!stored) return { ...defaultAdminAccessibility, reduceMotion: systemPrefersReducedMotion }
    const value: unknown = JSON.parse(stored)
    if (typeof value !== 'object' || value === null) {
      return { ...defaultAdminAccessibility, reduceMotion: systemPrefersReducedMotion }
    }
    const settings = value as Partial<AdminAccessibilitySettings>
    return {
      textScale: settings.textScale === 'large' || settings.textScale === 'largest'
        ? settings.textScale
        : 'normal',
      highContrast: settings.highContrast === true,
      reduceMotion: typeof settings.reduceMotion === 'boolean'
        ? settings.reduceMotion
        : systemPrefersReducedMotion,
      visibleFocus: settings.visibleFocus !== false,
      compactLayout: settings.compactLayout === true,
    }
  } catch {
    return { ...defaultAdminAccessibility, reduceMotion: systemPrefersReducedMotion }
  }
}

function readPublishedProduct(id: string, data: Record<string, unknown>): Product | null {
  const imageTones = ['peach', 'lavender', 'butter', 'mint'] as const
  if (
    typeof data.name !== 'string' ||
    typeof data.category !== 'string' ||
    typeof data.description !== 'string' ||
    typeof data.price !== 'number' ||
    !Number.isSafeInteger(data.price) ||
    data.price <= 0 ||
    data.price > 1_000_000_000 ||
    typeof data.image !== 'string'
  ) {
    return null
  }
  const imageTone = imageTones.includes(data.imageTone as (typeof imageTones)[number])
    ? data.imageTone as Product['imageTone']
    : 'peach'
  return {
    id,
    name: data.name,
    category: data.category,
    description: data.description,
    price: data.price,
    image: data.image,
    images: Array.isArray(data.images)
      ? [data.image, ...data.images.filter((image): image is string =>
        typeof image === 'string' && image.startsWith('https://') && image.length <= 2048,
      )].slice(0, 8)
      : [data.image],
    imageTone,
    characteristics: readProductAttributes(data.characteristics),
    specifications: readProductAttributes(data.specifications),
    ...(typeof data.originalPrice === 'number' ? { originalPrice: data.originalPrice } : {}),
    ...(typeof data.badge === 'string' ? { badge: data.badge } : {}),
    stock: typeof data.stock === 'number' ? data.stock : 50,
    active: data.active !== false,
  }
}

function formatReviewDate(value: string | null): string {
  if (!value) return 'Fecha no disponible'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Fecha no disponible'
    : date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}

type ProductDetailPageProps = {
  product: Product
  summary: ReviewSummary
  user: User | null
  emailVerified: boolean
  disabled: boolean
  cartQuantity: number
  cartCount: number
  cartJustAdded: boolean
  onClose: () => void
  onOpenCart: () => void
  onAdd: (product: Product, quantity: number) => boolean
  onLogin: () => void
  onSummaryChange: (productId: string, summary: ReviewSummary) => void
  relatedProducts: Product[]
  onOpenProduct: (product: Product) => void
}

function ProductDetailPage({
  product,
  summary,
  user,
  emailVerified,
  disabled,
  cartQuantity,
  cartCount,
  cartJustAdded,
  onClose,
  onOpenCart,
  onAdd,
  onLogin,
  onSummaryChange,
  relatedProducts,
  onOpenProduct,
}: ProductDetailPageProps) {
  const [reviewResult, setReviewResult] = useState<{
    viewerKey: string
    data: ProductReviewsResult
  } | null>(null)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [loadErrorViewerKey, setLoadErrorViewerKey] = useState('')
  const [notice, setNotice] = useState('')
  const [purchaseNotice, setPurchaseNotice] = useState('')
  const [selectedImage, setSelectedImage] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const viewerKey = user?.uid ?? 'guest'
  const reviewData = reviewResult?.viewerKey === viewerKey ? reviewResult.data : null
  const isLoading = reviewData === null && loadErrorViewerKey !== viewerKey

  function handleReviewMediaSelection(files: FileList | null) {
    if (!files) return
    const nextFiles = [...mediaFiles, ...Array.from(files)]
    const existingMedia = reviewData?.ownReview?.media ?? []
    const imageCount =
      existingMedia.filter((item) => item.type === 'image').length +
      nextFiles.filter((file) => file.type.startsWith('image/')).length
    const videoCount =
      existingMedia.filter((item) => item.type === 'video').length +
      nextFiles.filter((file) => file.type.startsWith('video/')).length
    const invalidFile = nextFiles.find((file) =>
      (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.type !== 'video/mp4') ||
      file.size < 1 ||
      file.size > (file.type === 'video/mp4' ? 25 : 8) * 1024 * 1024,
    )
    if (invalidFile) {
      setError(`${invalidFile.name}: usá JPEG, PNG o WebP de hasta 8 MB, o MP4 de hasta 25 MB.`)
    } else if (nextFiles.length + existingMedia.length > 5 || imageCount > 4 || videoCount > 1) {
      setError('Cada opinión admite hasta 4 imágenes y 1 video.')
    } else {
      setError('')
      setMediaFiles(nextFiles)
    }
  }

  useEffect(() => {
    let active = true
    void loadProductReviews(product.id, user)
      .then((data) => {
        if (!active) return
        setReviewResult({ viewerKey, data })
        setRating(data.ownReview?.rating ?? 5)
        setComment(data.ownReview?.comment ?? '')
        setError(data.mediaError ?? '')
        setLoadErrorViewerKey('')
        onSummaryChange(product.id, data.summary)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setLoadErrorViewerKey(viewerKey)
        setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar las opiniones.')
      })
    return () => {
      active = false
    }
  }, [onSummaryChange, product.id, user, viewerKey])

  async function handleReviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) {
      onLogin()
      return
    }
    if (!emailVerified) {
      setError('Verificá tu email desde Mi cuenta antes de publicar una opinión.')
      return
    }
    if (saving) return

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await saveProductReview(user, product.id, rating, comment)
      const uploadedMedia: ReviewMedia[] = []
      const failedMedia: File[] = []
      const mediaErrors: string[] = []
      for (const file of mediaFiles) {
        try {
          uploadedMedia.push(await uploadProductReviewMedia(user, product.id, file))
        } catch (uploadError) {
          failedMedia.push(file)
          mediaErrors.push(`${file.name}: ${uploadError instanceof Error ? uploadError.message : 'No se pudo subir.'}`)
        }
      }
      setMediaFiles(failedMedia)
      const normalizedComment = comment.trim().replace(/\s+/g, ' ')
      const now = new Date().toISOString()
      const updatedReview = {
        rating,
        comment: normalizedComment,
        createdAt: reviewData?.ownReview?.createdAt ?? now,
        editedAt: reviewData?.ownReview ? now : null,
        verifiedPurchase: true,
        mine: true,
        media: [...(reviewData?.ownReview?.media ?? []), ...uploadedMedia],
      }
      const updatedReviews: ProductReviewsResult = {
        reviews: [
          updatedReview,
          ...(reviewData?.reviews.filter((review) => !review.mine) ?? []),
        ],
        canReview: true,
        ownReview: updatedReview,
        summary: result.summary,
      }
      setReviewResult({ viewerKey, data: updatedReviews })
      setLoadErrorViewerKey('')
      setComment(normalizedComment)
      onSummaryChange(product.id, result.summary)
      if (mediaErrors.length) {
        setError(`La opinión de texto sí se guardó, pero algunos archivos no se pudieron adjuntar: ${mediaErrors.join(' ')}`)
        setNotice(uploadedMedia.length
          ? `${result.message} Los archivos cargados correctamente quedaron pendientes de aprobación.`
          : result.message)
      } else if (uploadedMedia.length) {
        setNotice(`${result.message} Las fotos y el video quedaron pendientes de aprobación.`)
      } else {
        setNotice(result.message)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No pudimos guardar tu opinión.')
    } finally {
      setSaving(false)
    }
  }

  const galleryImages = product.images?.length ? product.images : [product.image]
  const stock = product.stock ?? 50
  const maxAvailable = Math.max(0, Math.min(stock, MAX_ORDER_QUANTITY) - cartQuantity)
  const selectedQuantity = Math.min(quantity, Math.max(1, maxAvailable))

  return (
    <main className="product-detail-page">
      <header className="product-detail-topbar">
        <button className="product-detail-back" type="button" onClick={onClose}>
          <Icon name="arrow" size={16} /> Volver a la tienda
        </button>
        <a className="wordmark product-detail-wordmark" href="/" aria-label="Lúmina, inicio">lúmina<span className="wordmark-star">✳</span></a>
        <div className="product-detail-header-actions">
          <ThemeToggleButton />
          <button className="product-detail-cart-link" type="button" onClick={onOpenCart} aria-label={cartCount ? `Tu bolso, ${cartCount} unidades` : 'Tu bolso vacío'}>
            <Icon name="bag" size={16} /> Tu bolso <span>{cartCount || ''}</span>
          </button>
        </div>
      </header>

      <div className="product-detail-container">
        <nav className="product-breadcrumbs" aria-label="Ruta de navegación">
          <a href="/">Inicio</a><span>/</span><a href="/#productos">Productos</a><span>/</span><a href={`/#productos`}>{product.category}</a><span>/</span><strong>{product.name}</strong>
        </nav>

        <section className="product-detail-hero" aria-labelledby="product-reviews-title">
          <div className="product-detail-gallery">
            <div className={`product-detail-main-image image-${product.imageTone}`}>
              <img src={galleryImages[selectedImage] ?? product.image} alt={product.name} />
              {product.badge && <span className={`product-badge${product.originalPrice && product.originalPrice > product.price ? ' badge-offer' : ''}`}>{product.badge === 'Más elegido' ? 'Selección Lúmina' : product.badge}</span>}
            </div>
            {galleryImages.length > 1 && (
              <div className="product-detail-thumbnails" aria-label="Imágenes del producto">
                {galleryImages.map((image, index) => (
                  <button
                    key={image}
                    type="button"
                    className={selectedImage === index ? 'is-selected' : ''}
                    aria-label={`Ver imagen ${index + 1} de ${galleryImages.length}`}
                    aria-pressed={selectedImage === index}
                    onClick={() => setSelectedImage(index)}
                  >
                    <img src={image} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="product-detail-summary">
            <span className="eyebrow section-eyebrow">{product.category}</span>
            <h1 id="product-reviews-title">{product.name}</h1>
            <a className="product-detail-rating" href="#opiniones">
              <span className="review-stars">{summary.reviewCount ? '★★★★★' : '☆☆☆☆☆'}</span>
              <strong>{summary.reviewCount ? summary.ratingAverage.toFixed(1) : 'Sin calificaciones'}</strong>
              {summary.reviewCount > 0 && <span>({summary.reviewCount} opiniones verificadas)</span>}
            </a>

            <div className="product-detail-price">
              <strong>{money.format(product.price)}</strong>
              {product.originalPrice && <del>{money.format(product.originalPrice)}</del>}
              <span>{product.originalPrice && product.originalPrice > product.price ? 'Precio de oferta' : 'Precio publicado'}</span>
            </div>
            <p className={`product-stock-state ${stock > 0 ? 'is-available' : 'is-unavailable'}`}>
              <span aria-hidden="true" />{maxAvailable > 0
                ? `Disponible · ${maxAvailable} ${maxAvailable === 1 ? 'unidad' : 'unidades'} para agregar`
                : stock < 1 ? 'Sin stock disponible' : 'Límite de compra alcanzado'}
            </p>

            <div className="product-detail-purchase">
              <label htmlFor="product-quantity">Cantidad</label>
              <div className="quantity-control">
                <button type="button" aria-label="Quitar una unidad" onClick={() => setQuantity((current) => Math.max(1, current - 1))} disabled={selectedQuantity <= 1}><Icon name="minus" size={15} /></button>
                <input id="product-quantity" type="number" min="1" max={maxAvailable} value={selectedQuantity} onChange={(event) => setQuantity(Math.min(maxAvailable || 1, Math.max(1, Number(event.target.value) || 1)))} />
                <button type="button" aria-label="Agregar una unidad" onClick={() => setQuantity((current) => Math.min(maxAvailable, current + 1))} disabled={selectedQuantity >= maxAvailable}><Icon name="plus" size={15} /></button>
              </div>
              <button className={`button button-dark product-detail-add${cartJustAdded ? ' is-added' : ''}`} type="button" disabled={disabled || maxAvailable < 1} onClick={() => {
                if (onAdd(product, selectedQuantity)) setPurchaseNotice('Se agregó al bolso. Podés seguir explorando o revisar tu selección.')
                else setPurchaseNotice('No pudimos agregar esa cantidad. Revisá el stock disponible.')
              }}>
                {cartJustAdded ? 'Agregado al bolso' : 'Agregar al bolso'} <Icon name={cartJustAdded ? 'check' : 'bag'} size={17} />
              </button>
            </div>
            {purchaseNotice && <p className="product-purchase-notice" role="status">{purchaseNotice}</p>}

            <div className="product-detail-trust">
              <p><Icon name="check" size={15} /><span><strong>Pago en Mercado Pago</strong><small>Mercado Pago procesa el pago de tu compra.</small></span></p>
              <p><Icon name="box" size={15} /><span><strong>Envío</strong><small>El costo y las opciones se muestran al continuar con la compra.</small></span></p>
            </div>

            <a className="product-seller-card" href="#vendedor">
              <span className="product-seller-mark">✳</span>
              <span><small>VENDIDO POR</small><strong>Lúmina</strong><em>Tienda oficial</em></span>
              <Icon name="arrow" size={16} />
            </a>
          </div>
        </section>

        <nav className="product-detail-section-nav" aria-label="Secciones del producto">
          <a href="#descripcion">Descripción</a>
          {product.characteristics?.length ? <a href="#caracteristicas">Características</a> : null}
          {product.specifications?.length ? <a href="#especificaciones">Especificaciones</a> : null}
          <a href="#opiniones">Opiniones</a>
        </nav>

        <section className="product-detail-information">
          <div className="product-detail-main-column">
            <section className="product-detail-section" id="descripcion">
              <span className="eyebrow section-eyebrow">CONOCÉ LOS DETALLES</span>
              <h2>Descripción</h2>
              <p className="product-detail-description">{product.description}</p>
            </section>

            {!!product.characteristics?.length && (
              <section className="product-detail-section" id="caracteristicas">
                <span className="eyebrow section-eyebrow">LO QUE OFRECE</span>
                <h2>Características del producto</h2>
                <dl className="product-attribute-list">
                  {product.characteristics.map((attribute, index) => <div key={`${attribute.label}-${index}`}><dt>{attribute.label}</dt><dd>{attribute.value}</dd></div>)}
                </dl>
              </section>
            )}

            {!!product.specifications?.length && (
              <section className="product-detail-section" id="especificaciones">
                <span className="eyebrow section-eyebrow">INFORMACIÓN TÉCNICA</span>
                <h2>Especificaciones</h2>
                <dl className="product-attribute-list">
                  {product.specifications.map((attribute, index) => <div key={`${attribute.label}-${index}`}><dt>{attribute.label}</dt><dd>{attribute.value}</dd></div>)}
                </dl>
              </section>
            )}

            <section className="product-detail-section product-detail-seller" id="vendedor">
              <span className="eyebrow section-eyebrow">TU TIENDA DE CONFIANZA</span>
              <h2>Vendido por Lúmina</h2>
              <p>Somos una tienda. Consultá las características publicadas y el detalle de tu compra antes de pagar; los productos, precios y disponibilidad se muestran según el catálogo vigente.</p>
            </section>
          </div>

          <aside className="product-detail-aside">
            <div className="product-detail-payment-card">
              <span className="eyebrow section-eyebrow">MEDIOS DE PAGO</span>
              <h3>Pagá en Mercado Pago</h3>
              <p>El pago se realiza en Mercado Pago. Los medios y cuotas disponibles dependen de las opciones que Mercado Pago muestre para tu compra.</p>
            </div>
          </aside>
        </section>

        <section className="product-page-reviews" id="opiniones" aria-labelledby="product-review-list-title">
          <div className="product-page-reviews-heading">
            <span className="eyebrow section-eyebrow">EXPERIENCIAS REALES</span>
            <h2>Opiniones de compradores</h2>
            <p>Opiniones habilitadas para clientes con una compra aprobada de este producto.</p>
          </div>
        <div className={`product-reviews-content${!isLoading && !error && !reviewData?.reviews.length && !reviewData?.canReview ? ' is-empty' : ''}`}>
          <section className="product-review-list" aria-labelledby="product-review-list-title">
            <h3 id="product-review-list-title">Reseñas publicadas</h3>
            {isLoading ? (
              <p className="review-empty" role="status">Cargando opiniones verificadas…</p>
            ) : error && !reviewData ? (
              <p className="profile-form-error" role="alert">{error}</p>
            ) : reviewData?.reviews.length ? (
              reviewData.reviews.map((review, index) => (
                <article className="product-review-item" key={`${review.createdAt ?? 'review'}-${index}`}>
                  <div className="product-review-item-heading">
                    <span className="review-stars" aria-label={`${review.rating} de 5 estrellas`}>
                      {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                    </span>
                    <time>{formatReviewDate(review.editedAt ?? review.createdAt)}</time>
                  </div>
                  <strong>{review.mine ? 'Tu opinión' : 'Comprador verificado'}</strong>
                  <p>{review.comment}</p>
                  {!!review.media?.some((media) => media.status === 'approved') && (
                    <div className="review-media-gallery">
                      {review.media.filter((media) => media.status === 'approved').map((media) => media.type === 'video' ? (
                        <video key={media.id} src={media.url} controls preload="metadata" aria-label="Video de la opinión" />
                      ) : (
                        <a key={media.id} href={media.url} target="_blank" rel="noreferrer">
                          <img src={media.url} alt="Foto adjunta a una opinión verificada" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  )}
                  <span className="review-verified-label"><Icon name="check" size={13} /> Compra verificada{review.editedAt ? ' · editada' : ''}</span>
                </article>
              ))
            ) : (
              <p className="review-empty">Todavía no hay opiniones. La primera reseña aparecerá después de una compra verificada.</p>
            )}
            {reviewData?.mediaError && <p className="profile-form-error" role="alert">{reviewData.mediaError}</p>}
          </section>

          <section className="product-review-form-section" aria-labelledby="product-review-form-title">
            <h3 id="product-review-form-title">{reviewData?.ownReview ? 'Actualizar tu opinión' : 'Dejá tu opinión'}</h3>
            {reviewData?.canReview ? (
              !user ? (
                <div className="review-callout">
                  <p>Iniciá sesión con la cuenta que hizo la compra para dejar una opinión verificada.</p>
                  <button className="button button-dark profile-save-button" type="button" onClick={onLogin}>Iniciar sesión</button>
                </div>
              ) : !emailVerified ? (
                <p className="review-callout">Verificá tu email desde Mi cuenta para publicar o actualizar tu opinión.</p>
              ) : (
                <form className="product-review-form" onSubmit={(event) => void handleReviewSubmit(event)}>
                  <label>Puntuación</label>
                  <div className="review-rating-picker" role="radiogroup" aria-label="Puntuación del producto">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={rating === value}
                        aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'}`}
                        className={value <= rating ? 'active' : ''}
                        key={value}
                        onClick={() => setRating(value)}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <label htmlFor="product-review-comment">Tu experiencia</label>
                  <textarea
                    id="product-review-comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    minLength={10}
                    maxLength={1000}
                    rows={5}
                    placeholder="Contá qué te pareció el producto. No incluyas datos personales."
                    required
                  />
                  <span className="review-character-count">{comment.length}/1000</span>
                  <label className="review-media-label" htmlFor="product-review-media">Fotos o video (opcional)</label>
                  <input
                    id="product-review-media"
                    className="review-media-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4"
                    multiple
                    disabled={saving || isLoading || Boolean(reviewData?.mediaError)}
                    onChange={(event) => {
                      handleReviewMediaSelection(event.currentTarget.files)
                      event.currentTarget.value = ''
                    }}
                  />
                  <small>Hasta 4 imágenes (8 MB c/u) y 1 video MP4 (25 MB). El equipo revisará los archivos antes de publicarlos.</small>
                  {!!mediaFiles.length && (
                    <ul className="review-selected-media">
                      {mediaFiles.map((file, index) => (
                        <li key={`${file.name}-${file.lastModified}-${index}`}>
                          <span>{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                          <button type="button" onClick={() => setMediaFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={saving}>Quitar</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!!reviewData?.ownReview?.media.length && (
                    <div className="review-own-media">
                      <strong>Archivos de tu opinión</strong>
                      <div className="review-media-gallery">
                        {reviewData.ownReview.media.map((media) => (
                          <div className="review-own-media-item" key={media.id}>
                            {media.status === 'approved'
                              ? media.type === 'video'
                                ? <video src={media.url} controls preload="metadata" aria-label="Tu video adjunto" />
                                : <img src={media.url} alt="Tu foto adjunta" loading="lazy" />
                              : <small>Vista previa privada · pendiente de revisión</small>}
                            {media.status === 'approved' && <small>Publicado</small>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {error && <p className="profile-form-error" role="alert">{error}</p>}
                  {notice && <p className="review-success" role="status">{notice}</p>}
                  <button className="button button-dark profile-save-button" type="submit" disabled={saving || isLoading}>
                    {saving ? <><span className="button-spinner" aria-hidden="true" /> Guardando…</> : reviewData.ownReview ? 'Actualizar opinión' : 'Publicar opinión'}
                  </button>
                  <small>Una opinión por cuenta y producto. Podés editarla más adelante.</small>
                </form>
              )
            ) : (
              <div className="review-callout">
                <p>Las opiniones están reservadas a quienes completaron el pago de este producto. Así cada reseña refleja una compra real.</p>
                {!user && <button className="auth-switch" type="button" onClick={onLogin}>Iniciar sesión para consultar si tu compra ya está habilitada</button>}
              </div>
            )}
          </section>
        </div>
        </section>
        {relatedProducts.length > 0 && (
          <section className="product-related-section" aria-labelledby="product-related-title">
            <span className="eyebrow section-eyebrow">SEGUÍ EXPLORANDO</span>
            <h2 id="product-related-title">También puede gustarte</h2>
            <div className="product-related-grid">
              {relatedProducts.slice(0, 4).map((relatedProduct) => (
                <button className="product-related-card" type="button" key={relatedProduct.id} onClick={() => onOpenProduct(relatedProduct)}>
                  <img src={relatedProduct.image} alt="" loading="lazy" />
                  <span>{relatedProduct.name}</span>
                  <strong>{money.format(relatedProduct.price)}</strong>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      <footer className="product-detail-footer"><a className="wordmark" href="/">lúmina<span className="wordmark-star">✳</span></a><span>Un detalle, todo tu estilo.</span><a href="/">Volver a la tienda</a></footer>
    </main>
  )
}

type ProductCardProps = {
  product: Product
  summary: ReviewSummary
  isFavorite: boolean
  addedToCart: boolean
  disabled: boolean
  onFavorite: (productId: string) => void
  onAdd: (product: Product) => void
  onOpen: (product: Product) => void
}

const ProductCard = memo(function ProductCard({
  product,
  summary,
  isFavorite,
  addedToCart,
  disabled,
  onFavorite,
  onAdd,
  onOpen,
}: ProductCardProps) {
  return (
    <article className="product-card">
      <div className={`product-image image-${product.imageTone}`}>
        <img src={product.image} alt={product.name} loading="lazy" />
        {product.badge && <span className={`product-badge${product.badge === 'Más elegido' ? ' badge-pink' : ''}${product.originalPrice && product.originalPrice > product.price ? ' badge-offer' : ''}`}>{product.badge === 'Más elegido' ? 'Selección Lúmina' : product.badge}</span>}
        <button
          className={`favorite-button ${isFavorite ? 'is-favorite' : ''}`}
          onClick={() => onFavorite(product.id)}
          disabled={disabled}
          aria-label={isFavorite ? `Quitar ${product.name} de favoritos` : `Guardar ${product.name} en favoritos`}
          aria-pressed={isFavorite}
        >
          <Icon name="heart" size={19} />
        </button>
        <button className={`quick-add${addedToCart ? ' is-added' : ''}`} onClick={() => onAdd(product)} disabled={disabled} aria-live="polite">
          <Icon name={addedToCart ? 'check' : 'plus'} size={17} /> {addedToCart ? 'Agregado al bolso' : 'Agregar al bolso'}
        </button>
      </div>
      <div className="product-info">
        <div className="product-meta"><span>{product.category}</span><span className="product-rating" aria-label={summary.reviewCount ? `${summary.ratingAverage.toFixed(1)} sobre 5, ${summary.reviewCount} opiniones` : 'Sin opiniones verificadas'}>
          {summary.reviewCount ? <>★ <b>{summary.ratingAverage.toFixed(1)}</b> <small>({summary.reviewCount})</small></> : <small>Sin opiniones</small>}
        </span></div>
        <h3><button className="product-details-link" type="button" onClick={() => onOpen(product)}>{product.name}</button></h3>
        <button className="product-reviews-link" type="button" onClick={() => onOpen(product)}>
          {summary.reviewCount ? `Ver opiniones (${summary.reviewCount})` : 'Ver detalle y opiniones'}
        </button>
        <div className="product-price">
          <strong>{money.format(product.price)}</strong>
          {product.originalPrice && <del>{money.format(product.originalPrice)}</del>}
        </div>
      </div>
    </article>
  )
})

type ProductRailProps = {
  id: string
  title: string
  description: string
  products: Product[]
  favorites: string[]
  addedProductId: string
  reviewSummaries: Record<string, ReviewSummary>
  disabled: boolean
  onFavorite: (productId: string) => void
  onAdd: (product: Product) => void
  onOpenProduct: (product: Product) => void
}

function ProductRail({
  id,
  title,
  description,
  products: railProducts,
  favorites,
  addedProductId,
  reviewSummaries,
  disabled,
  onFavorite,
  onAdd,
  onOpenProduct,
}: ProductRailProps) {
  const railRef = useRef<HTMLDivElement>(null)
  if (!railProducts.length) return null

  function scrollRail(direction: -1 | 1) {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <section className="product-rail-section section-wrap" aria-labelledby={`${id}-title`}>
      <header className="product-rail-heading">
        <div><h2 id={`${id}-title`}>{title}</h2><p>{description}</p></div>
        {railProducts.length > 1 && (
          <div className="product-rail-controls">
            <button type="button" onClick={() => scrollRail(-1)} aria-label={`Ver productos anteriores: ${title}`}><Icon name="arrow" size={17} /></button>
            <button type="button" onClick={() => scrollRail(1)} aria-label={`Ver más productos: ${title}`}><Icon name="arrow" size={17} /></button>
          </div>
        )}
      </header>
      <div className={`product-rail${railProducts.length === 1 ? ' is-single-product' : ''}`} ref={railRef}>
        {railProducts.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            summary={reviewSummaries[product.id] ?? emptyReviewSummary}
            isFavorite={favorites.includes(product.id)}
            addedToCart={addedProductId === product.id}
            disabled={disabled}
            onFavorite={onFavorite}
            onAdd={onAdd}
            onOpen={onOpenProduct}
          />
        ))}
      </div>
    </section>
  )
}

function Storefront() {
  const [activeCategory, setActiveCategory] = useState('Todo')
  const [search, setSearch] = useState('')
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [heroSlideIndex, setHeroSlideIndex] = useState(0)
  const [heroPaused, setHeroPaused] = useState(false)
  const [announcementIndex, setAnnouncementIndex] = useState(0)
  const [announcementPaused, setAnnouncementPaused] = useState(false)
  const [shoppingGuideOpen, setShoppingGuideOpen] = useState(false)
  const [productSort, setProductSort] = useState<ProductSort>('recommended')
  const [saleOnly, setSaleOnly] = useState(false)
  const [favorites, setFavorites] = useState<string[]>(() => readGuestStore().favorites)
  const [cart, setCart] = useState<Record<string, number>>(() => readGuestStore().cart)
  const [catalog, setCatalog] = useState<Product[]>(products)
  const [customCategories, setCustomCategories] = useState<string[]>([])
  const [reviewSummaries, setReviewSummaries] = useState<Record<string, ReviewSummary>>({})
  const [reviewSummaryError, setReviewSummaryError] = useState('')
  const [productRouteId, setProductRouteId] = useState(getProductRouteId)
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [paymentReturnOrderId, setPaymentReturnOrderId] = useState(() => getPaymentReturnParams().orderId)
  const [paymentReturnPaymentId] = useState(() => getPaymentReturnParams().paymentId)
  const [paymentReturnStatus, setPaymentReturnStatus] = useState<
    'checking' | 'approved' | 'pending' | 'failed' | 'review' | 'error'
  >('checking')
  const [paymentReturnMessage, setPaymentReturnMessage] = useState('')
  const [paymentReturnOrder, setPaymentReturnOrder] = useState<CustomerOrderStatus | null>(null)
  const [paymentRefreshCount, setPaymentRefreshCount] = useState(0)
  const [checkoutShipping, setCheckoutShipping] = useState<ShippingAddress>({
    ...emptyCustomerProfile,
  })
  const [authOpen, setAuthOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [customerOrdersPageOpen, setCustomerOrdersPageOpen] = useState(false)
  const [customerOrders, setCustomerOrders] = useState<CustomerOrderSummary[]>([])
  const [customerOrdersLoading, setCustomerOrdersLoading] = useState(true)
  const [customerOrdersError, setCustomerOrdersError] = useState('')
  const [customerOrdersRefresh, setCustomerOrdersRefresh] = useState(0)
  const [deliveryCelebrationOrderId, setDeliveryCelebrationOrderId] = useState('')
  const [selectedCustomerOrderId, setSelectedCustomerOrderId] = useState('')
  const [selectedCustomerOrder, setSelectedCustomerOrder] = useState<CustomerOrderStatus | null>(null)
  const [selectedCustomerOrderStatus, setSelectedCustomerOrderStatus] = useState<
    'checking' | 'approved' | 'pending' | 'failed' | 'review' | 'error'
  >('checking')
  const [selectedCustomerOrderMessage, setSelectedCustomerOrderMessage] = useState('')
  const [selectedCustomerOrderRefresh, setSelectedCustomerOrderRefresh] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminAccessStatus, setAdminAccessStatus] = useState<'checking' | 'admin' | 'not-admin' | 'error'>('checking')
  const [adminAccessError, setAdminAccessError] = useState('')
  const [adminOpen, setAdminOpen] = useState(() => window.location.pathname === '/admin')
  const [adminTab, setAdminTab] = useState<'orders' | 'products' | 'categories' | 'reviews' | 'access'>('orders')
  const [adminAccessibility, setAdminAccessibility] = useState(readAdminAccessibilitySettings)
  const [adminOrders, setAdminOrders] = useState<AdminOrder[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminWishlistCounts, setAdminWishlistCounts] = useState<Record<string, number>>({})
  const [adminWishlistLoading, setAdminWishlistLoading] = useState(false)
  const [adminWishlistError, setAdminWishlistError] = useState('')
  const [adminWishlistRefresh, setAdminWishlistRefresh] = useState(0)
  const [adminCategoryDraft, setAdminCategoryDraft] = useState('')
  const [adminCategoryBusy, setAdminCategoryBusy] = useState(false)
  const [adminCategoryError, setAdminCategoryError] = useState('')
  const [pendingReviewMedia, setPendingReviewMedia] = useState<PendingReviewMedia[]>([])
  const [adminProductReviews, setAdminProductReviews] = useState<AdminProductReview[]>([])
  const [adminReviewMediaLoading, setAdminReviewMediaLoading] = useState(false)
  const [adminProductReviewsLoading, setAdminProductReviewsLoading] = useState(false)
  const [adminReviewMediaBusy, setAdminReviewMediaBusy] = useState('')
  const [adminReviewDeleteBusy, setAdminReviewDeleteBusy] = useState('')
  const [adminReviewMediaRefresh, setAdminReviewMediaRefresh] = useState(0)
  const [adminReviewMediaCursor, setAdminReviewMediaCursor] = useState('')
  const [pendingReviewMediaNextCursor, setPendingReviewMediaNextCursor] = useState<string | null>(null)
  const [pendingReviewMediaHasMore, setPendingReviewMediaHasMore] = useState(false)
  const [adminProductReviewsCursor, setAdminProductReviewsCursor] = useState('')
  const [adminProductReviewsNextCursor, setAdminProductReviewsNextCursor] = useState<string | null>(null)
  const [adminProductReviewsHasMore, setAdminProductReviewsHasMore] = useState(false)
  const [adminShipmentBusy, setAdminShipmentBusy] = useState('')
  const [adminMessageThreads, setAdminMessageThreads] = useState<Record<string, boolean>>({})
  const [adminError, setAdminError] = useState('')
  const [adminUserEmail, setAdminUserEmail] = useState('')
  const [adminUserBusy, setAdminUserBusy] = useState(false)
  const [adminRevokeBusy, setAdminRevokeBusy] = useState(false)
  const [adminProductDraft, setAdminProductDraft] = useState<AdminProductDraft>(emptyAdminProductDraft)
  const [adminProductBusy, setAdminProductBusy] = useState(false)
  const [adminProductUploadBusy, setAdminProductUploadBusy] = useState(false)
  const [adminEditingProductId, setAdminEditingProductId] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login')
  const [authLoading, setAuthLoading] = useState(firebaseReady)
  const [storeLoading, setStoreLoading] = useState(false)
  const [storeReadyForUid, setStoreReadyForUid] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [emailVerified, setEmailVerified] = useState(false)
  const [notice, setNotice] = useState('')
  const [cartFeedbackProductId, setCartFeedbackProductId] = useState('')
  const [authError, setAuthError] = useState('')
  const [accountError, setAccountError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile>(emptyCustomerProfile)
  const [customerProfileDraft, setCustomerProfileDraft] = useState<CustomerProfile>(emptyCustomerProfile)
  const [customerProfileLoadedForUid, setCustomerProfileLoadedForUid] = useState<string | null>(null)
  const [customerProfileError, setCustomerProfileError] = useState('')
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const interactionStateRef = useRef({ favorites, cart, storeLoading, authLoading })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const shoppingGuideTriggerRef = useRef<HTMLButtonElement>(null)
  const shoppingGuideCloseRef = useRef<HTMLButtonElement>(null)
  const shoppingGuideDialogRef = useRef<HTMLElement>(null)
  const adminDashboardRef = useRef<HTMLElement>(null)
  const adminPreviousFocus = useRef<HTMLElement | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const cartFeedbackTimeout = useRef<number | null>(null)
  const knownAdminOrderIds = useRef<Set<string> | null>(null)
  const clearedPaymentOrderIds = useRef<Set<string>>(new Set())
  const paymentReturnNotifiedOrderIds = useRef<Set<string>>(new Set())
  const orderSnapshots = useRef(new Map<string, {
    status: string
    paymentStatus: string
    shipmentStage?: string | null
    shipmentStageDetail?: string | null
  }>())
  const pendingPaymentCartRemovals = useRef(
    new Map<string, CustomerOrderStatus['items']>(),
  )
  const storeReadyUid = useRef<string | null>(null)
  const notificationStore = useNotificationStore(user?.uid ?? null)
  const { addNotification } = notificationStore
  const hasBlockingOverlay = authOpen || accountOpen || cartOpen || checkoutOpen ||
    profileEditorOpen || shoppingGuideOpen

  useEffect(() => {
    interactionStateRef.current = { favorites, cart, storeLoading, authLoading }
  }, [favorites, cart, storeLoading, authLoading])

  useEffect(() => {
    try {
      window.localStorage.setItem('lumina:admin-accessibility', JSON.stringify(adminAccessibility))
    } catch (error) {
      console.warn('No se pudieron guardar las preferencias de accesibilidad del panel.', error)
    }
  }, [adminAccessibility])

  useEffect(() => {
    if (window.location.pathname !== '/admin' || authLoading || adminAccessStatus === 'checking') return
    if (!isAdmin) window.location.replace('/')
  }, [adminAccessStatus, authLoading, isAdmin])

  useEffect(() => {
    const syncRoutes = () => {
      setProductRouteId(getProductRouteId())
      setAdminOpen(window.location.pathname === '/admin')
    }
    window.addEventListener('popstate', syncRoutes)
    return () => window.removeEventListener('popstate', syncRoutes)
  }, [])

  useEffect(() => {
    orderSnapshots.current.clear()
  }, [user?.uid])

  const observeOrder = useCallback((order: {
    id: string
    status: string
    paymentStatus: string
    shipmentStage?: string | null
    shipmentStageDetail?: string | null
  }) => {
    const previous = orderSnapshots.current.get(order.id)
    const deliveryTransitioned = Boolean(
      previous &&
      (previous.status !== 'delivered' && order.status === 'delivered' ||
        previous.shipmentStage !== 'delivered' && order.shipmentStage === 'delivered'),
    )
    if (previous) {
      const statusChanged = previous.status !== order.status
      const paymentChanged = previous.paymentStatus !== order.paymentStatus
      if (statusChanged || paymentChanged) {
        const changes: string[] = []
        if (statusChanged) changes.push(getOrderStatusLabel(order.status))
        if (paymentChanged) {
          changes.push(order.paymentStatus === 'approved'
            ? 'Pago acreditado'
            : order.paymentStatus === 'refunded'
              ? 'Pago reembolsado'
              : order.paymentStatus === 'pending'
                ? 'Pago pendiente'
                : 'Estado de pago actualizado')
        }
        addNotification({
          id: order.paymentStatus === 'approved'
            ? `payment-confirmed:${order.id}`
            : `order-update:${order.id}:${order.status}:${order.paymentStatus}`,
          kind: 'order',
          title: order.paymentStatus === 'approved'
            ? order.status === 'payment_review' ? 'Pago acreditado · compra en revisión' : '¡Compra confirmada!'
            : 'Actualización de tu compra',
          message: order.paymentStatus === 'approved'
            ? order.status === 'payment_review'
                ? `Recibimos el pago del pedido ${order.id.slice(0, 8).toLocaleUpperCase('es-AR')}. Te avisaremos cuando termine la revisión.`
                : `Tu pago fue acreditado. Estamos preparando el pedido ${order.id.slice(0, 8).toLocaleUpperCase('es-AR')}.`
            : `Pedido ${order.id.slice(0, 8).toLocaleUpperCase('es-AR')} · ${changes.join(' · ')}.`,
          createdAt: new Date().toISOString(),
          orderId: order.id,
        })
      }
      if (
        order.shipmentStage !== undefined &&
        previous.shipmentStage !== undefined &&
        (
          previous.shipmentStage !== order.shipmentStage ||
          previous.shipmentStageDetail !== order.shipmentStageDetail
        )
      ) {
        addNotification({
          id: `shipment-update:${order.id}:${order.shipmentStage ?? 'sin-etapa'}:${order.shipmentStageDetail ?? ''}`,
          kind: 'order',
          title: 'Novedad en tu envío',
          message: order.shipmentStageDetail || getShipmentStageLabel(order.shipmentStage ?? ''),
          createdAt: new Date().toISOString(),
          orderId: order.id,
        })
      }
    }
    orderSnapshots.current.set(order.id, {
      status: order.status,
      paymentStatus: order.paymentStatus,
      ...(order.shipmentStage !== undefined
        ? { shipmentStage: order.shipmentStage }
        : previous?.shipmentStage !== undefined
          ? { shipmentStage: previous.shipmentStage }
          : {}),
      ...(order.shipmentStageDetail !== undefined
        ? { shipmentStageDetail: order.shipmentStageDetail }
        : previous?.shipmentStageDetail !== undefined
          ? { shipmentStageDetail: previous.shipmentStageDetail }
          : {}),
    })
    return deliveryTransitioned
  }, [addNotification])

  const handleIncomingChatMessage = useCallback((orderId: string, message: { id: string; createdAt: string | null }) => {
    addNotification({
      id: `chat-message:${orderId}:${message.id}`,
      kind: 'message',
      title: 'Nuevo mensaje en tu compra',
      message: `El equipo de Lúmina te escribió en el chat del pedido ${orderId.slice(0, 8).toLocaleUpperCase('es-AR')}.`,
      createdAt: message.createdAt ?? new Date().toISOString(),
      orderId,
    })
  }, [addNotification])

  useEffect(() => {
    if (mobileSearchOpen) searchInputRef.current?.focus()
  }, [mobileSearchOpen])

  useEffect(() => {
    if (!shoppingGuideOpen) return

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    shoppingGuideCloseRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setShoppingGuideOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const dialog = shoppingGuideDialogRef.current
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [shoppingGuideOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase('en-US') === 'k') {
        const target = event.target
        if (
          target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('input, textarea, select'))
        ) return
        event.preventDefault()
        setMobileSearchOpen(true)
        window.requestAnimationFrame(() => searchInputRef.current?.focus())
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (announcementPaused) return
    const interval = window.setInterval(() => {
      setAnnouncementIndex((current) => (current + 1) % announcementMessages.length)
    }, 6500)
    return () => window.clearInterval(interval)
  }, [announcementPaused])

  useEffect(() => {
    if (heroPaused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setHeroSlideIndex((current) => (current + 1) % heroSlides.length)
      }
    }, 6500)
    return () => window.clearInterval(interval)
  }, [heroPaused])

  useEffect(() => {
    const nextSlide = heroSlides[(heroSlideIndex + 1) % heroSlides.length]
    const nextImage = new Image()
    nextImage.decoding = 'async'
    nextImage.src = nextSlide.image
  }, [heroSlideIndex])

  useEffect(() => {
    let active = true
    void loadReviewSummaries()
      .then((summaries) => {
        if (active) setReviewSummaries(summaries)
      })
      .catch((error: unknown) => {
        console.error('No se pudieron cargar las puntuaciones verificadas de los productos.', error)
        if (active) setReviewSummaryError('No pudimos cargar las opiniones en este momento.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!paymentReturnOrderId || !user) return
    const currentUrl = new URL(window.location.href)
    if (
      currentUrl.searchParams.get('payment') !== 'return' &&
      !currentUrl.searchParams.has('payment_id') &&
      !currentUrl.searchParams.has('collection_id')
    ) return
    currentUrl.searchParams.set('payment', 'return')
    currentUrl.searchParams.set('order_id', paymentReturnOrderId)
    currentUrl.searchParams.delete('payment_id')
    currentUrl.searchParams.delete('collection_id')
    currentUrl.searchParams.delete('external_reference')
    currentUrl.searchParams.delete('collection_status')
    currentUrl.searchParams.delete('merchant_order_id')
    currentUrl.searchParams.delete('status')
    currentUrl.searchParams.delete('payment_type')
    currentUrl.searchParams.delete('preference_id')
    currentUrl.searchParams.delete('site_id')
    currentUrl.searchParams.delete('processing_mode')
    currentUrl.searchParams.delete('merchant_account_id')
    window.history.replaceState(
      window.history.state,
      '',
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    )
  }, [paymentReturnOrderId, user])

  useEffect(() => {
    if (!paymentReturnOrderId) return
    if (!user || authLoading) return

    let active = true
    let unsubscribe = () => {}

    const handleOrderUpdate = (result: { order: CustomerOrderStatus }) => {
      if (!active) return
      observeOrder(result.order)
      setPaymentReturnMessage('')
      const { paymentStatus, status } = result.order
      setPaymentReturnOrder(result.order)
      if (paymentStatus === 'approved' && status === 'payment_review') {
        if (!paymentReturnNotifiedOrderIds.current.has(paymentReturnOrderId)) {
          paymentReturnNotifiedOrderIds.current.add(paymentReturnOrderId)
          addNotification({
            id: `payment-confirmed:${paymentReturnOrderId}`,
            kind: 'order',
            title: 'Pago acreditado · compra en revisión',
            message: `Recibimos el pago del pedido ${paymentReturnOrderId.slice(0, 8).toLocaleUpperCase('es-AR')}. Te avisaremos cuando termine la revisión.`,
            createdAt: new Date().toISOString(),
            orderId: paymentReturnOrderId,
          })
        }
        setPaymentReturnStatus('review')
        return
      }
      if (paymentStatus === 'approved') {
        if (!paymentReturnNotifiedOrderIds.current.has(paymentReturnOrderId)) {
          paymentReturnNotifiedOrderIds.current.add(paymentReturnOrderId)
          addNotification({
            id: `payment-confirmed:${paymentReturnOrderId}`,
            kind: 'order',
            title: '¡Compra confirmada!',
            message: `Tu pago fue acreditado. Estamos preparando el pedido ${paymentReturnOrderId.slice(0, 8).toLocaleUpperCase('es-AR')}.`,
            createdAt: new Date().toISOString(),
            orderId: paymentReturnOrderId,
          })
        }
        if (!clearedPaymentOrderIds.current.has(paymentReturnOrderId)) {
          clearedPaymentOrderIds.current.add(paymentReturnOrderId)
          if (storeReadyUid.current !== user.uid) {
            pendingPaymentCartRemovals.current.set(
              `${user.uid}:${paymentReturnOrderId}`,
              result.order.items,
            )
          } else {
            setCart((current) => {
              const next = { ...current }
              result.order.items.forEach(({ id, quantity }) => {
                const remainingQuantity = (next[id] ?? 0) - quantity
                if (remainingQuantity > 0) next[id] = remainingQuantity
                else delete next[id]
              })
              return next
            })
          }
        }
        setPaymentReturnStatus('approved')
        return
      }
      if (
        ['rejected', 'cancelled', 'refunded', 'charged_back', 'expired', 'preference_failed'].includes(paymentStatus) ||
        ['payment_failed', 'payment_expired'].includes(status)
      ) {
        setPaymentReturnStatus('failed')
        return
      }
      setPaymentReturnStatus('pending')
    }

    unsubscribe = pollCustomerOrder(
      user,
      paymentReturnOrderId,
      handleOrderUpdate,
      (error) => {
        if (!active) return
        console.error('No se pudo recibir la actualización del pedido.', error)
        setPaymentReturnMessage(error instanceof Error ? error.message : 'No pudimos recibir actualizaciones del pedido.')
        setPaymentReturnStatus('error')
      },
      paymentReturnPaymentId,
      (error) => {
        if (!active) return
        console.error('No se pudo conciliar el pago con Mercado Pago.', error)
        setPaymentReturnMessage(
          `${error.message} El pedido sí se consultó y volveremos a verificar el pago automáticamente.`,
        )
      },
    )

    return () => {
      active = false
      unsubscribe()
    }
  }, [addNotification, authLoading, observeOrder, paymentRefreshCount, paymentReturnOrderId, paymentReturnPaymentId, storeLoading, storeReadyForUid, user])

  useEffect(() => {
    if (!user || authLoading || customerOrdersPageOpen || selectedCustomerOrderId || paymentReturnOrderId) return
    let active = true
    let timeout: number | undefined
    const refreshOrderSnapshots = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const orders = await loadCustomerOrders(user)
          if (!active) return
          orders.forEach(observeOrder)
        } catch (error) {
          if (active) console.error('No se pudieron revisar las novedades de tus compras.', error)
        }
      }
      if (active) timeout = window.setTimeout(() => void refreshOrderSnapshots(), 15_000)
    }
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timeout !== undefined) window.clearTimeout(timeout)
        void refreshOrderSnapshots()
      }
    }
    void refreshOrderSnapshots()
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [authLoading, customerOrdersPageOpen, observeOrder, paymentReturnOrderId, selectedCustomerOrderId, user])

  useEffect(() => {
    if (!customerOrdersPageOpen || !user) return

    let active = true
    let timeout: number | undefined

    const refreshOrders = async () => {
      try {
        const orders = await loadCustomerOrders(user)
        if (!active) return
        orders.forEach(observeOrder)
        setCustomerOrders(orders)
        setCustomerOrdersError('')
        setCustomerOrdersLoading(false)
        timeout = window.setTimeout(() => void refreshOrders(), 15_000)
      } catch (error) {
        if (!active) return
        console.error('No se pudieron cargar las compras del cliente.', error)
        setCustomerOrdersError(
          error instanceof Error ? error.message : 'No pudimos cargar tus compras.',
        )
        setCustomerOrdersLoading(false)
      }
    }

    void refreshOrders()
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [customerOrdersPageOpen, customerOrdersRefresh, observeOrder, user])

  useEffect(() => {
    if (!selectedCustomerOrderId || !user) return

    let active = true
    let timeout: number | undefined
    const refreshOrder = async () => {
      try {
        const order = await loadCustomerOrder(user, selectedCustomerOrderId)
        if (!active) return
        if (observeOrder(order)) setDeliveryCelebrationOrderId(order.id)
        setSelectedCustomerOrder(order)
        setSelectedCustomerOrderMessage('')
        if (order.paymentStatus === 'approved') {
          setSelectedCustomerOrderStatus(order.status === 'payment_review' ? 'review' : 'approved')
        } else if (
          ['rejected', 'cancelled', 'refunded', 'charged_back', 'expired', 'preference_failed']
            .includes(order.paymentStatus) ||
          ['payment_failed', 'payment_expired'].includes(order.status)
        ) {
          setSelectedCustomerOrderStatus('failed')
        } else {
          setSelectedCustomerOrderStatus('pending')
        }
        timeout = window.setTimeout(() => void refreshOrder(), 15_000)
      } catch (error) {
        if (!active) return
        console.error('No se pudo cargar el detalle de la compra.', error)
        setSelectedCustomerOrderMessage(
          error instanceof Error ? error.message : 'No pudimos cargar el detalle de tu compra.',
        )
        setSelectedCustomerOrderStatus('error')
      }
    }

    void refreshOrder()
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [observeOrder, selectedCustomerOrderId, selectedCustomerOrderRefresh, user])

  useEffect(() => {
    if (!hasBlockingOverlay) return

    const scrollY = window.scrollY
    const root = document.documentElement
    const body = document.body
    const previousRootOverflow = root.style.overflow
    const previousRootScrollBehavior = root.style.scrollBehavior
    const previousBodyOverflow = body.style.overflow
    const previousBodyPosition = body.style.position
    const previousBodyTop = body.style.top
    const previousBodyWidth = body.style.width

    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'

    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
      body.style.position = previousBodyPosition
      body.style.top = previousBodyTop
      body.style.width = previousBodyWidth
      root.style.scrollBehavior = 'auto'
      window.scrollTo(0, scrollY)
      root.style.scrollBehavior = previousRootScrollBehavior
    }
  }, [hasBlockingOverlay])

  useEffect(() => {
    if (!adminOpen || !isAdmin) return
    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.inert ?? false
    const previousOverflow = document.body.style.overflow
    const activeElement = document.activeElement
    adminPreviousFocus.current = activeElement instanceof HTMLElement ? activeElement : null
    if (appRoot) appRoot.inert = true
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => adminDashboardRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      if (appRoot) appRoot.inert = previousInert
      document.body.style.overflow = previousOverflow
      if (adminPreviousFocus.current?.isConnected) adminPreviousFocus.current.focus()
      adminPreviousFocus.current = null
    }
  }, [adminOpen, isAdmin])

  async function refreshCatalog() {
    const { db, firestoreSdk } = await getFirebaseServices()
    const snapshot = await firestoreSdk.getDocs(firestoreSdk.collection(db, 'products'))
    const published = snapshot.docs.flatMap((product) => {
      const data: Record<string, unknown> = product.data()
      const parsed = readPublishedProduct(product.id, data)
      return parsed ? [parsed] : []
    })
    setCatalog((current) => {
      const merged = new Map(current.map((product) => [product.id, product]))
      published.forEach((product) => merged.set(product.id, product))
      return [...merged.values()]
    })
  }

  useEffect(() => {
    if (!firebaseReady) return
    let active = true
    let unsubscribe = () => {}

    void getFirebaseServices()
      .then(({ auth, authSdk }) => {
        if (active) {
          unsubscribe = authSdk.onAuthStateChanged(auth, (currentUser) => {
            setAuthLoading(false)
            setEmailVerified(currentUser?.emailVerified ?? false)
            setCustomerProfile(emptyCustomerProfile)
            setCustomerProfileDraft(emptyCustomerProfile)
            setCustomerProfileLoadedForUid(null)
            setCustomerProfileError('')
            storeReadyUid.current = null
            setIsAdmin(false)
            setAdminAccessStatus(currentUser ? 'checking' : 'not-admin')
            setAdminAccessError('')
            knownAdminOrderIds.current = null
            const adminRouteRequested = window.location.pathname === '/admin'
            setAdminOpen(adminRouteRequested)
            if (adminRouteRequested) {
              setAuthOpen(false)
              setAccountOpen(false)
            }
            if (!currentUser) {
              setProfileEditorOpen(false)
              setCustomerOrdersPageOpen(false)
              setSelectedCustomerOrderId('')
              setSelectedCustomerOrder(null)
              setCustomerOrders([])
              const guestStore = readGuestStore()
              setCustomerProfile(emptyCustomerProfile)
              setFavorites(guestStore.favorites)
              setCart(guestStore.cart)
              setAccountOpen(false)
              setAccountError('')
              setStoreLoading(false)
              setStoreReadyForUid(null)
            } else {
              setStoreLoading(true)
              setStoreReadyForUid(null)
            }
            setUser(currentUser)
          })
        }
      })
      .catch((error: unknown) => {
        console.error('No se pudo iniciar Firebase Authentication.', error)
        setAuthLoading(false)
        setNotice('No se pudo conectar con Firebase.')
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!firebaseReady) return
    let active = true
    void getFirebaseServices()
      .then(async ({ db, firestoreSdk }) => {
        const snapshot = await firestoreSdk.getDocs(firestoreSdk.collection(db, 'products'))
        if (!active || snapshot.empty) return
        const published = snapshot.docs.flatMap((product) => {
          const data: Record<string, unknown> = product.data()
          const parsed = readPublishedProduct(product.id, data)
          return parsed ? [parsed] : []
        })
        setCatalog((current) => {
          const merged = new Map(current.map((product) => [product.id, product]))
          published.forEach((product) => merged.set(product.id, product))
          return [...merged.values()]
        })
      })
      .catch((error: unknown) => {
        console.error('No se pudo cargar el catálogo publicado desde Firestore.', error)
        if (active) setNotice('No pudimos actualizar las publicaciones. Mostramos el catálogo de demostración.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!firebaseReady) return
    let active = true
    void getFirebaseServices()
      .then(async ({ db, firestoreSdk }) => {
        const snapshot = await firestoreSdk.getDocs(firestoreSdk.collection(db, 'categories'))
        if (!active) return
        const names = snapshot.docs.flatMap((category) => {
          const data: Record<string, unknown> = category.data()
          if (typeof data.name !== 'string') return []
          const name = data.name
          return name === category.id &&
            name.trim() === name &&
            name.length > 0 &&
            name.length <= 40 &&
            !name.includes('/') &&
            !defaultCategories.some((base) => base.toLocaleLowerCase('es-AR') === name.toLocaleLowerCase('es-AR'))
            ? [name]
            : []
        })
        setCustomCategories([...new Set(names)].sort((left, right) => left.localeCompare(right, 'es-AR')))
        setAdminCategoryError('')
      })
      .catch((error: unknown) => {
        console.error('No se pudieron cargar las categorías personalizadas.', error)
        if (active) setAdminCategoryError('No pudimos cargar las categorías. Revisá tu conexión e intentá actualizar.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!user || !firebaseReady) return
    let active = true
    void checkAdminAccess(user)
      .then((hasAccess) => {
        if (!active) return
        setIsAdmin(hasAccess)
        setAdminAccessStatus(hasAccess ? 'admin' : 'not-admin')
      })
      .catch((error: unknown) => {
        console.error('No se pudo comprobar el acceso al panel de administración.', error)
        if (active) {
          setIsAdmin(false)
          setAdminAccessStatus('error')
          setAdminAccessError(error instanceof Error ? error.message : 'No se pudo verificar el acceso de administración.')
        }
      })
    return () => {
      active = false
    }
  }, [user])

  useEffect(() => {
    if (!adminOpen || !isAdmin || !user) return
    let active = true
    const refreshOrders = async () => {
      try {
        const orders = await loadAdminOrders(user)
        if (!active) return
        const nextIds = new Set(orders.map((order) => order.id))
        if (knownAdminOrderIds.current) {
          const newOrders = orders.filter((order) => !knownAdminOrderIds.current?.has(order.id))
          if (newOrders.length) {
            setNotice(newOrders.length === 1
              ? 'Se registró un nuevo pedido. Revisá su estado de pago.'
              : `Se registraron ${newOrders.length} pedidos nuevos. Revisá sus estados de pago.`)
          }
        }
        knownAdminOrderIds.current = nextIds
        setAdminOrders(orders)
        setAdminError('')
      } catch (error) {
        console.error('No se pudieron cargar los pedidos en el panel de administración.')
        if (active) setAdminError(error instanceof Error ? error.message : 'No se pudieron cargar los pedidos.')
      } finally {
        if (active) setAdminLoading(false)
      }
    }
    void refreshOrders()
    const interval = window.setInterval(() => void refreshOrders(), 12000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [adminOpen, isAdmin, user])

  useEffect(() => {
    if (!adminOpen || !isAdmin || adminTab !== 'products' || !user) return
    let active = true
    const refreshWishlistCounts = async () => {
      setAdminWishlistLoading(true)
      try {
        const counts = await loadAdminWishlistCounts(user, catalog.map((product) => product.id))
        if (!active) return
        setAdminWishlistCounts(counts)
        setAdminWishlistError('')
      } catch (error) {
        console.error('No se pudieron cargar los conteos de favoritos de los productos.', error)
        if (active) {
          setAdminWishlistError(error instanceof Error ? error.message : 'No se pudieron cargar los favoritos.')
        }
      } finally {
        if (active) setAdminWishlistLoading(false)
      }
    }
    void refreshWishlistCounts()
    const interval = window.setInterval(() => void refreshWishlistCounts(), 60_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [adminOpen, adminTab, adminWishlistRefresh, catalog, isAdmin, user])

  useEffect(() => {
    if (!adminOpen || !isAdmin || adminTab !== 'reviews' || !user) return
    let active = true
    void loadPendingReviewMedia(user, adminReviewMediaCursor)
      .then((page) => {
        if (!active) return
        setPendingReviewMedia(page.media)
        setPendingReviewMediaHasMore(page.hasMore)
        setPendingReviewMediaNextCursor(page.nextCursor)
      })
      .catch((error: unknown) => {
        console.error('No se pudieron cargar los archivos pendientes de moderación.', error)
        if (active) setAdminError(error instanceof Error
          ? error.message
          : 'No se pudieron cargar los archivos pendientes.')
      })
      .finally(() => {
        if (active) setAdminReviewMediaLoading(false)
      })
    return () => {
      active = false
    }
  }, [adminOpen, adminReviewMediaCursor, adminReviewMediaRefresh, adminTab, isAdmin, user])

  useEffect(() => {
    if (!adminOpen || !isAdmin || adminTab !== 'reviews' || !user) return
    let active = true
    void loadAdminProductReviews(user, adminProductReviewsCursor)
      .then((page) => {
        if (!active) return
        setAdminProductReviews((current) => adminProductReviewsCursor
          ? [...current, ...page.reviews]
          : page.reviews)
        setAdminProductReviewsHasMore(page.hasMore)
        setAdminProductReviewsNextCursor(page.nextCursor)
      })
      .catch((error: unknown) => {
        console.error('No se pudieron cargar las opiniones para administración.', error)
        if (active) setAdminError(error instanceof Error
          ? error.message
          : 'No se pudieron cargar las opiniones publicadas.')
      })
      .finally(() => {
        if (active) setAdminProductReviewsLoading(false)
      })
    return () => {
      active = false
    }
  }, [adminOpen, adminProductReviewsCursor, adminReviewMediaRefresh, adminTab, isAdmin, user])

  useEffect(() => {
    if (!user || authLoading) return
    let active = true
    const uid = user.uid

    void loadAndMergeUserStore(uid)
      .then((store) => {
        if (!active) return
        setFavorites(store.favorites)
        const pendingRemovals = [...pendingPaymentCartRemovals.current.entries()]
          .filter(([key]) => key.startsWith(`${uid}:`))
        const mergedCart = { ...store.cart }
        pendingRemovals.forEach(([key, items]) => {
          items.forEach(({ id, quantity }) => {
            const remainingQuantity = (mergedCart[id] ?? 0) - quantity
            if (remainingQuantity > 0) mergedCart[id] = remainingQuantity
            else delete mergedCart[id]
          })
          pendingPaymentCartRemovals.current.delete(key)
        })
        setCart(mergedCart)
        storeReadyUid.current = uid
        setStoreReadyForUid(uid)
        setAccountError('')
      })
      .catch((error: unknown) => {
        console.error('No se pudo sincronizar el bolso y los favoritos con Firestore.', error)
        if (active) {
          setStoreReadyForUid(null)
          setAccountError(getProfileErrorMessage(error))
        }
      })
      .finally(() => {
        if (active) setStoreLoading(false)
      })

    return () => {
      active = false
    }
  }, [authLoading, user])

  useEffect(() => {
    if (!user || !firebaseReady) return

    let active = true
    void getFirebaseServices()
      .then(async ({ db, firestoreSdk }) => {
        const profileRef = firestoreSdk.doc(db, 'users', user.uid)
        const snapshot = await firestoreSdk.getDoc(profileRef)
        if (!active) return
        const data = snapshot.data()
        const readString = (field: keyof CustomerProfile) =>
          typeof data?.[field] === 'string' ? data[field] : ''
        setCustomerProfileError('')
        setCustomerProfile({
          name: readString('name') || user.displayName || '',
          phone: readString('phone'),
          address: readString('address'),
          apartment: readString('apartment'),
          city: readString('city'),
          province: readString('province'),
          postalCode: readString('postalCode'),
        })
        setCustomerProfileDraft({
          name: readString('name') || user.displayName || '',
          phone: readString('phone'),
          address: readString('address'),
          apartment: readString('apartment'),
          city: readString('city'),
          province: readString('province'),
          postalCode: readString('postalCode'),
        })
        setCustomerProfileLoadedForUid(user.uid)
      })
      .catch((error: unknown) => {
        console.error('No se pudo cargar el perfil editable desde Firestore.', error)
        if (active) {
          setCustomerProfileError(getProfileErrorMessage(error))
          setCustomerProfileLoadedForUid(user.uid)
        }
      })

    return () => {
      active = false
    }
  }, [authLoading, user])

  useEffect(() => {
    if (user || authLoading || storeLoading) return
    try {
      saveGuestStore({ favorites, cart })
    } catch (error) {
      console.error('No se pudieron guardar los datos locales del bolso y favoritos.', error)
    }
  }, [authLoading, cart, favorites, storeLoading, user])

  useEffect(() => {
    if (!user || storeLoading || storeReadyForUid !== user.uid) return
    const uid = user.uid
    const store: UserStore = { favorites, cart }

    saveQueue.current = saveQueue.current
      .then(
        () => saveUserStore(uid, store),
        () => saveUserStore(uid, store),
      )
      .catch((error: unknown) => {
        console.error('No se pudieron guardar el bolso y los favoritos en Firestore.', error)
        if (user?.uid === uid) setAccountError(getProfileErrorMessage(error))
      })
  }, [cart, favorites, storeLoading, storeReadyForUid, user])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => () => {
    if (cartFeedbackTimeout.current !== null) window.clearTimeout(cartFeedbackTimeout.current)
  }, [])

  const visibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es-AR')
    const filtered = catalog.filter((product) => {
      if (product.active === false) return false
      const matchesCategory =
        activeCategory === 'Todo' || product.category === activeCategory
      const matchesSale = !saleOnly || Boolean(product.originalPrice && product.originalPrice > product.price)
      const matchesSearch =
        !normalizedSearch ||
        `${product.name} ${product.category} ${product.description}`
          .toLocaleLowerCase('es-AR')
          .includes(normalizedSearch)
      return matchesCategory && matchesSearch && matchesSale
    })
    return filtered.sort((left, right) => {
      if (productSort === 'price-asc') return left.price - right.price
      if (productSort === 'price-desc') return right.price - left.price
      if (productSort === 'rating') {
        return (reviewSummaries[right.id]?.ratingAverage ?? 0) -
          (reviewSummaries[left.id]?.ratingAverage ?? 0)
      }
      if (productSort === 'newest') {
        return Number(right.badge === 'Nuevo') - Number(left.badge === 'Nuevo')
      }
      return 0
    })
  }, [activeCategory, catalog, productSort, reviewSummaries, saleOnly, search])
  const categories = useMemo(
    () => ['Todo', ...defaultCategories, ...customCategories],
    [customCategories],
  )
  const categoryCounts = useMemo(
    () => Object.fromEntries(
      categories.map((category) => [
        category,
        catalog.filter((product) =>
          product.active !== false && (category === 'Todo' || product.category === category),
        ).length,
      ]),
    ),
    [catalog, categories],
  )
  const activeCatalog = useMemo(
    () => catalog.filter((product) => product.active !== false),
    [catalog],
  )
  const dealProducts = useMemo(
    () => activeCatalog
      .filter((product) => product.originalPrice && product.originalPrice > product.price)
      .sort((left, right) => {
        const leftDiscount = left.originalPrice ? (left.originalPrice - left.price) / left.originalPrice : 0
        const rightDiscount = right.originalPrice ? (right.originalPrice - right.price) / right.originalPrice : 0
        return rightDiscount - leftDiscount
      })
      .slice(0, 10),
    [activeCatalog],
  )
  const personalizedProducts = useMemo(() => {
    const favoriteCategories = favorites.reduce<Record<string, number>>((counts, productId) => {
      const favorite = activeCatalog.find((product) => product.id === productId)
      if (favorite) counts[favorite.category] = (counts[favorite.category] ?? 0) + 1
      return counts
    }, {})
    return activeCatalog
      .filter((product) => !favorites.includes(product.id))
      .sort((left, right) =>
        (favoriteCategories[right.category] ?? 0) - (favoriteCategories[left.category] ?? 0) ||
        (reviewSummaries[right.id]?.ratingAverage ?? 0) -
          (reviewSummaries[left.id]?.ratingAverage ?? 0),
      )
      .slice(0, 10)
  }, [activeCatalog, favorites, reviewSummaries])

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({
          product: catalog.find((item) => item.id === id && item.active !== false),
          quantity,
        }))
        .filter((item): item is { product: Product; quantity: number } =>
          Boolean(item.product),
        ),
    [cart, catalog],
  )
  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0)
  const cartTotal = cartItems.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0,
  )
  const estimatedShipping = cartTotal >= 45000 ? 0 : cartTotal === 0 ? 0 : 3500
  const favoriteProducts = catalog.filter((product) => favorites.includes(product.id))
  const customerProfileLoading =
    Boolean(user) && customerProfileLoadedForUid !== user?.uid
  const completedProfileFields = profileCompletionFields.filter((field) =>
    customerProfile[field].trim(),
  ).length
  const profileCompletion = Math.round(
    (completedProfileFields / profileCompletionFields.length) * 100,
  )
  const handleReviewSummaryChange = useCallback((productId: string, summary: ReviewSummary) => {
    setReviewSummaries((current) => ({ ...current, [productId]: summary }))
    setReviewSummaryError('')
  }, [])
  const toggleFavorite = useCallback((id: string) => {
    if (interactionStateRef.current.storeLoading || interactionStateRef.current.authLoading) return
    const removing = interactionStateRef.current.favorites.includes(id)
    setFavorites((current) => removing
      ? current.filter((favoriteId) => favoriteId !== id)
      : [...current, id])
    setNotice(removing ? 'Se quitó de tus favoritos.' : 'Guardado en tus favoritos.')
  }, [])
  const addToCart = useCallback((product: Product, requestedQuantity = 1): boolean => {
    if (interactionStateRef.current.storeLoading || interactionStateRef.current.authLoading) return false
    const stock = product.stock ?? 50
    const existingQuantity = interactionStateRef.current.cart[product.id] ?? 0
    const available = Math.max(0, Math.min(stock, MAX_ORDER_QUANTITY) - existingQuantity)
    const quantity = Math.min(Math.max(1, requestedQuantity), available)
    if (quantity < 1) {
      setNotice(stock < 1 ? 'Este producto no tiene stock disponible.' : 'Ya agregaste todas las unidades disponibles.')
      return false
    }
    setCart((current) => ({
      ...current,
      [product.id]: Math.min(stock, (current[product.id] ?? 0) + quantity),
    }))
    setCartFeedbackProductId(product.id)
    if (cartFeedbackTimeout.current !== null) window.clearTimeout(cartFeedbackTimeout.current)
    cartFeedbackTimeout.current = window.setTimeout(() => {
      setCartFeedbackProductId('')
      cartFeedbackTimeout.current = null
    }, 1400)
    setNotice(`${quantity} ${quantity === 1 ? 'unidad' : 'unidades'} de ${product.name} se sumaron a tu bolso`)
    return true
  }, [])
  const openProductDetails = useCallback((product: Product) => {
    if (getProductRouteId() !== product.id) {
      window.history.pushState({ luminaProduct: true }, '', `/producto/${encodeURIComponent(product.id)}`)
    }
    setProductRouteId(product.id)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  if (authLoading) {
    return (
      <div className="brand-loading" role="status" aria-live="polite">
        <div className="loading-orbit loading-orbit-outer" aria-hidden="true" />
        <div className="loading-orbit loading-orbit-inner" aria-hidden="true" />
        <div className="loading-brand">
          <span className="loading-wordmark">lúmina<span>✳</span></span>
          <span className="loading-tagline">UN DETALLE, TODO TU ESTILO</span>
        </div>
        <div className="loading-progress" aria-hidden="true"><span /></div>
        <p>Preparando tu espacio</p>
      </div>
    )
  }

  function closeProductDetails() {
    if (window.history.state?.luminaProduct === true) {
      window.history.back()
      return
    }
    window.history.replaceState({}, '', '/')
    setProductRouteId('')
  }

  function openProductCart() {
    closeProductDetails()
    setCartOpen(true)
  }

  function openLoginForReview() {
    closeProductDetails()
    setAuthMode('login')
    setAuthError('')
    setAuthOpen(true)
  }

  function changeQuantity(id: string, amount: number) {
    if (storeLoading) return
    const product = catalog.find((item) => item.id === id)
    const maximum = Math.min(product?.stock ?? 50, MAX_ORDER_QUANTITY)
    if (amount > 0 && (cart[id] ?? 0) >= maximum) {
      setNotice(`Podés agregar hasta ${maximum} unidades de este producto por compra.`)
      return
    }
    setCart((current) => {
      const nextQuantity = (current[id] ?? 0) + amount
      if (nextQuantity <= 0) {
        const next = { ...current }
        delete next[id]
        return next
      }
      return { ...current, [id]: nextQuantity }
    })
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthError('')
    setAccountError('')
    if (authMode === 'reset') {
      const formData = new FormData(event.currentTarget)
      await handlePasswordReset(String(formData.get('email') ?? '').trim())
      return
    }

    if (!firebaseReady) {
      setAuthError('Firebase todavía no está configurado. Revisá el archivo .env.local.')
      return
    }

    const formData = new FormData(event.currentTarget)
    const name = String(formData.get('name') ?? '').trim()
    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')
    setAuthBusy(true)

    try {
      const { auth, db, authSdk, firestoreSdk } = await getFirebaseServices()
      let authenticatedUser: User
      let verificationEmailMessage = ''
      let verificationEmailError = ''
      if (authMode === 'register') {
        const credential = await authSdk.createUserWithEmailAndPassword(auth, email, password)
        authenticatedUser = credential.user
        setStoreLoading(true)
        setStoreReadyForUid(null)
        setUser(authenticatedUser)
        setEmailVerified(authenticatedUser.emailVerified)
        try {
          await authSdk.updateProfile(authenticatedUser, { displayName: name })
        } catch (error) {
          console.error('La cuenta se creó, pero no se pudo actualizar el nombre del perfil.', error)
          setAccountError('La cuenta se creó, pero no pudimos guardar tu nombre. Podés actualizarlo más tarde.')
        }
        try {
          verificationEmailMessage = await requestVerificationEmail(authenticatedUser)
        } catch (error) {
          console.error('La cuenta se creó, pero la API no pudo enviar el correo de verificación.')
          verificationEmailError = getEmailRequestError(error)
        }
      } else {
        const credential = await authSdk.signInWithEmailAndPassword(auth, email, password)
        authenticatedUser = credential.user
        setEmailVerified(authenticatedUser.emailVerified)
      }

      setStoreLoading(true)
      setStoreReadyForUid(null)
      setUser(authenticatedUser)
      setAuthOpen(false)
      const adminRouteRequested = window.location.pathname === '/admin'
      setAccountOpen(!adminRouteRequested)
      if (adminRouteRequested) setAdminOpen(true)
      setNotice(
        authMode === 'register' && verificationEmailMessage
          ? verificationEmailMessage
          : authMode === 'register'
            ? 'Tu cuenta ya está creada. Revisá el aviso en Mi cuenta.'
            : '¡Qué lindo verte de nuevo!',
      )

      try {
        const profileRef = firestoreSdk.doc(db, 'users', authenticatedUser.uid)
        const profile = await firestoreSdk.getDoc(profileRef)
        if (!profile.exists()) {
          await firestoreSdk.setDoc(profileRef, {
            name: authenticatedUser.displayName || name || email.split('@')[0],
            email: authenticatedUser.email ?? email,
            createdAt: firestoreSdk.serverTimestamp(),
          })
        }
      } catch (error) {
        console.error('La sesión inició, pero no se pudo cargar o crear el perfil de Firestore.', error)
        setAccountError(getProfileErrorMessage(error))
      }
      if (verificationEmailError) {
        setAccountError(`La cuenta se creó, pero no pudimos enviar el email de verificación. ${verificationEmailError}`)
      }
    } catch (error) {
      console.error('No se pudo completar el inicio de sesión o el registro.', error)
      setAuthError(getAuthErrorMessage(error))
    } finally {
      setAuthBusy(false)
    }
  }

  async function handlePasswordReset(address: string) {
    if (!firebaseReady) {
      setAuthError('Firebase todavía no está configurado.')
      return
    }

    setAuthBusy(true)
    setAuthError('')
    try {
      const message = await requestPasswordResetEmail(address)
      setAuthOpen(false)
      setNotice(message)
    } catch (error) {
      console.error('La API no pudo procesar la solicitud de restablecimiento de contraseña.')
      setAuthError(getEmailRequestError(error))
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleResendVerification() {
    if (!user || user.emailVerified) return
    setAuthBusy(true)
    setAccountError('')
    try {
      const message = await requestVerificationEmail(user)
      setNotice(message)
    } catch (error) {
      console.error('La API no pudo reenviar el correo de verificación.')
      setAccountError(getEmailRequestError(error))
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleCheckVerification() {
    if (!user) return
    setProfileBusy(true)
    setAccountError('')
    try {
      const { auth, authSdk } = await getFirebaseServices()
      await authSdk.reload(user)
      const currentUser = auth.currentUser
      const verified = currentUser?.emailVerified ?? false
      setEmailVerified(verified)
      if (verified) {
        setNotice('¡Email verificado! Gracias.')
      } else {
        setAccountError('Todavía no figura como verificado. Abrí el enlace del último email y volvé a comprobar.')
      }
    } catch (error) {
      console.error('No se pudo comprobar la verificación del email.', error)
      setAccountError(getAuthErrorMessage(error))
    } finally {
      setProfileBusy(false)
    }
  }

  async function handleRetryProfile() {
    if (!user || !firebaseReady) return
    setProfileBusy(true)
    try {
      const { db, firestoreSdk } = await getFirebaseServices()
      const profileRef = firestoreSdk.doc(db, 'users', user.uid)
      const profile = await firestoreSdk.getDoc(profileRef)
      if (!profile.exists()) {
        await firestoreSdk.setDoc(profileRef, {
          name: user.displayName || user.email?.split('@')[0] || 'Cliente Lúmina',
          email: user.email,
          createdAt: firestoreSdk.serverTimestamp(),
        })
      }
      setStoreLoading(true)
      const store = await loadAndMergeUserStore(user.uid)
      setFavorites(store.favorites)
      setCart(store.cart)
      setStoreReadyForUid(user.uid)
      setAccountError('')
      setNotice('Tu perfil está actualizado.')
    } catch (error) {
      console.error('No se pudo reintentar la carga del perfil de Firestore.', error)
      setAccountError(getProfileErrorMessage(error))
    } finally {
      setStoreLoading(false)
      setProfileBusy(false)
    }
  }

  async function handleCustomerProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !firebaseReady) return

    const formData = new FormData(event.currentTarget)
    const nextProfile: CustomerProfile = {
      name: String(formData.get('profile-name') ?? '').trim(),
      phone: String(formData.get('phone') ?? '').trim(),
      address: String(formData.get('address') ?? '').trim(),
      apartment: String(formData.get('apartment') ?? '').trim(),
      city: String(formData.get('city') ?? '').trim(),
      province: String(formData.get('province') ?? '').trim(),
      postalCode: String(formData.get('postalCode') ?? '').trim(),
    }

    setProfileBusy(true)
    setCustomerProfileError('')
    try {
      const { db, firestoreSdk } = await getFirebaseServices()
      const profileRef = firestoreSdk.doc(db, 'users', user.uid)
      const snapshot = await firestoreSdk.getDoc(profileRef)
      const profileData = {
        ...nextProfile,
        email: user.email,
        updatedAt: firestoreSdk.serverTimestamp(),
        ...(!snapshot.exists() ? { createdAt: firestoreSdk.serverTimestamp() } : {}),
      }
      await firestoreSdk.setDoc(profileRef, profileData, { merge: true })
      setCustomerProfile(nextProfile)
      setCustomerProfileDraft(nextProfile)
      setProfileEditorOpen(false)
      setCustomerProfileLoadedForUid(user.uid)
      setNotice('Guardamos los datos de tu perfil.')
    } catch (error) {
      console.error('No se pudieron guardar los datos del perfil en Firestore.', error)
      setCustomerProfileError(getProfileErrorMessage(error))
    } finally {
      setProfileBusy(false)
    }
  }

  function openProfileEditor() {
    setCustomerProfileDraft(customerProfile)
    setCustomerProfileError('')
    setProfileEditorOpen(true)
  }

  function startCheckout() {
    setCartOpen(false)
    if (!user) {
      setNotice('Ingresá a tu cuenta para continuar con el pago.')
      setAuthMode('login')
      setAuthOpen(true)
      return
    }
    setCheckoutShipping({
      name: customerProfile.name || user.displayName || '',
      phone: customerProfile.phone,
      address: customerProfile.address,
      apartment: customerProfile.apartment,
      city: customerProfile.city,
      province: customerProfile.province,
      postalCode: customerProfile.postalCode,
    })
    setCheckoutError('')
    setCheckoutOpen(true)
  }

  async function handleMercadoPagoCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || checkoutBusy) return
    const formData = new FormData(event.currentTarget)
    const shipping: ShippingAddress = {
      name: String(formData.get('shipping-name') ?? '').trim(),
      phone: String(formData.get('shipping-phone') ?? '').trim(),
      address: String(formData.get('shipping-address') ?? '').trim(),
      apartment: String(formData.get('shipping-apartment') ?? '').trim(),
      city: String(formData.get('shipping-city') ?? '').trim(),
      province: String(formData.get('shipping-province') ?? '').trim(),
      postalCode: String(formData.get('shipping-postal') ?? '').trim(),
    }
    if (cartItems.length === 0) {
      setCheckoutError('Tu bolso está vacío. Agregá algún producto antes de continuar.')
      return
    }
    if (cartItems.some(({ product, quantity }) =>
      quantity > Math.min(product.stock ?? 50, MAX_ORDER_QUANTITY),
    )) {
      setCheckoutError('Alguna cantidad de tu bolso supera el stock disponible o el máximo de 20 unidades por producto. Ajustala antes de continuar.')
      return
    }
    setCheckoutBusy(true)
    setCheckoutError('')
    try {
      const result = await createCheckoutPreference(
        user,
        cartItems.map(({ product, quantity }) => ({
          productId: product.id,
          expectedPrice: product.price,
          quantity,
        })),
        shipping,
      )
      setCustomerProfile(shipping)
      setCustomerProfileDraft(shipping)
      setCheckoutOpen(false)
      window.location.assign(result.checkoutUrl)
    } catch (error) {
      console.error('No se pudo iniciar el checkout de Mercado Pago.')
      if (error instanceof CommerceApiError && error.code === 'price_changed') {
        try {
          await refreshCatalog()
          setCheckoutError(`${error.message} Recargamos los precios; revisá el nuevo total y volvé a intentar.`)
        } catch (catalogError) {
          console.error('No se pudo actualizar el catálogo tras detectar un cambio de precio.', catalogError)
          setCheckoutError('El precio cambió y no pudimos actualizar el catálogo. Recargá la tienda antes de volver a intentar.')
        }
      } else {
        setCheckoutError(error instanceof Error ? error.message : 'No pudimos registrar el pedido.')
      }
    } finally {
      setCheckoutBusy(false)
    }
  }

  async function handleAdminProductSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !isAdmin || adminProductBusy) return
    const formData = new FormData(event.currentTarget)
    const name = String(formData.get('name') ?? '').trim()
    const id = adminEditingProductId ?? name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-AR')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const category = String(formData.get('category') ?? '')
    const description = String(formData.get('description') ?? '').trim()
    const image = adminProductDraft.image.trim()
    const images = adminProductDraft.galleryImages
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
    const uniqueImageCount = new Set([image, ...images].filter(Boolean)).size
    const price = Number(formData.get('price'))
    const originalPriceInput = String(formData.get('originalPrice') ?? '').trim()
    const originalPrice = originalPriceInput ? Number(originalPriceInput) : undefined
    const stock = Number(formData.get('stock'))
    const validAttributes = (attributes: ProductAttribute[]) =>
      attributes.length <= 30 &&
      attributes.every((attribute) =>
        attribute.label.trim().length > 0 &&
        attribute.label.length <= 60 &&
        attribute.value.trim().length > 0 &&
        attribute.value.length <= 300,
      )
    if (
      !id ||
      id.length > 80 ||
      !name ||
      !description ||
      description.length > 5000 ||
      !categories.slice(1).includes(category) ||
      !Number.isFinite(price) ||
      !Number.isSafeInteger(price) ||
      price <= 0 ||
      price > 1_000_000_000 ||
      (originalPriceInput !== '' &&
        (!Number.isSafeInteger(originalPrice) ||
          (originalPrice ?? 0) <= price ||
          (originalPrice ?? 0) > 1_000_000_000)) ||
      !Number.isInteger(stock) ||
      stock < 0 ||
      stock > 1_000_000 ||
      !image.startsWith('https://') ||
      image.length > 2048 ||
      images.length > 7 ||
      uniqueImageCount < 5 ||
      uniqueImageCount !== images.length + 1 ||
      images.some((url) => !url.startsWith('https://') || url.length > 2048) ||
      !validAttributes(adminProductDraft.characteristics) ||
      !validAttributes(adminProductDraft.specifications)
    ) {
      setAdminError('Revisá los campos. Si aplicás una oferta, el precio anterior debe ser entero y mayor al precio actual. Agregá entre 5 y 8 fotos HTTPS distintas, una descripción de hasta 5000 caracteres y hasta 30 atributos por sección.')
      return
    }

    setAdminProductBusy(true)
    setAdminError('')
    try {
      const { db, firestoreSdk } = await getFirebaseServices()
      const productRef = firestoreSdk.doc(db, 'products', id)
      const existing = await firestoreSdk.getDoc(productRef)
      if (existing.exists() && !adminEditingProductId) {
        throw new Error('Ya existe un producto con ese identificador. Editalo desde la lista.')
      }
      const imageTone: Product['imageTone'] =
        category === 'Bijou' ? 'lavender' : category === 'Bolsos' ? 'butter' : category === 'Cabello' ? 'mint' : 'peach'
      const previousBadge = existing.data()?.badge
      const productData = {
        id,
        name,
        category,
        description,
        price,
        originalPrice: originalPrice ?? null,
        badge: originalPrice !== undefined
          ? 'Oferta'
          : typeof previousBadge === 'string' && previousBadge !== 'Oferta'
            ? previousBadge
            : null,
        image,
        images,
        characteristics: adminProductDraft.characteristics,
        specifications: adminProductDraft.specifications,
        imageTone,
        stock,
        active: true,
        updatedAt: firestoreSdk.serverTimestamp(),
        ...(!existing.exists() ? { createdAt: firestoreSdk.serverTimestamp() } : {}),
      }
      await firestoreSdk.setDoc(productRef, productData, { merge: true })
      const parsed = readPublishedProduct(id, productData)
      if (parsed) {
        setCatalog((current) => {
          const next = new Map(current.map((product) => [product.id, product]))
          next.set(parsed.id, parsed)
          return [...next.values()]
        })
      }
      setAdminProductDraft(emptyAdminProductDraft)
      setAdminEditingProductId(null)
      setNotice(existing.exists() ? 'Se actualizaron los datos del producto.' : 'Publicaste un producto nuevo.')
    } catch (error) {
      console.error('No se pudo guardar el producto desde el panel de administración.')
      setAdminError(error instanceof Error ? error.message : 'No se pudo guardar el producto.')
    } finally {
      setAdminProductBusy(false)
    }
  }

  async function handleAdminCategoryCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !isAdmin || adminCategoryBusy) return
    const name = adminCategoryDraft.trim().replace(/\s+/g, ' ')
    if (!name || name.length > 40 || name.includes('/') || name.includes('\\')) {
      setAdminCategoryError('Usá un nombre de hasta 40 caracteres, sin barras.')
      return
    }
    if (categories.slice(1).some((category) => category.toLocaleLowerCase('es-AR') === name.toLocaleLowerCase('es-AR'))) {
      setAdminCategoryError('Ya existe una categoría con ese nombre.')
      return
    }

    setAdminCategoryBusy(true)
    setAdminCategoryError('')
    try {
      const { db, firestoreSdk } = await getFirebaseServices()
      await firestoreSdk.setDoc(firestoreSdk.doc(db, 'categories', name), {
        id: name,
        name,
        createdAt: firestoreSdk.serverTimestamp(),
        updatedAt: firestoreSdk.serverTimestamp(),
      })
      setCustomCategories((current) => [...current, name].sort((left, right) => left.localeCompare(right, 'es-AR')))
      setAdminCategoryDraft('')
    } catch (error) {
      console.error('No se pudo crear la categoría.', error)
      setAdminCategoryError(error instanceof Error ? error.message : 'No pudimos crear la categoría. Intentá nuevamente.')
    } finally {
      setAdminCategoryBusy(false)
    }
  }

  async function handleAdminProductImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (!files.length || !user || !isAdmin || adminProductUploadBusy || adminProductBusy) return

    const existingImages = Array.from(new Set([
      adminProductDraft.image.trim(),
      ...adminProductDraft.galleryImages.split(/\r?\n/).map((url) => url.trim()),
    ].filter(Boolean)))
    if (files.length > 8 - existingImages.length) {
      setAdminError(`Este producto admite hasta 8 fotos en total; ahora hay ${existingImages.length}.`)
      return
    }
    if (files.some((file) =>
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size < 1 ||
      file.size > 8 * 1024 * 1024,
    )) {
      setAdminError('Usá imágenes JPEG, PNG o WebP de hasta 8 MB cada una.')
      return
    }

    const productId = adminEditingProductId ?? adminProductDraft.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-AR')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (!productId || productId.length > 80) {
      setAdminError('Ingresá un nombre de producto válido antes de cargar sus fotos.')
      return
    }

    setAdminProductUploadBusy(true)
    setAdminError('')
    const uploadedUrls: string[] = []
    let uploadError = ''
    try {
      for (const file of files) {
        try {
          uploadedUrls.push(await uploadAdminProductImage(user, productId, file))
        } catch (error) {
          uploadError = error instanceof Error ? error.message : 'No se pudo cargar una de las imágenes.'
          break
        }
      }
      if (uploadedUrls.length) {
        setAdminProductDraft((current) => {
          const allImages = Array.from(new Set([
            current.image.trim(),
            ...current.galleryImages.split(/\r?\n/).map((url) => url.trim()),
            ...uploadedUrls,
          ].filter(Boolean)))
          const image = current.image.trim() || allImages[0]
          return {
            ...current,
            image,
            galleryImages: allImages.filter((url) => url !== image).join('\n'),
          }
        })
        if (!uploadError) {
          setNotice(`Se cargaron ${uploadedUrls.length} ${uploadedUrls.length === 1 ? 'foto' : 'fotos'} del producto.`)
        }
      }
      if (uploadError) {
        setAdminError(uploadedUrls.length
          ? `Se cargaron ${uploadedUrls.length} de ${files.length} fotos. ${uploadError}`
          : uploadError)
      }
    } finally {
      setAdminProductUploadBusy(false)
    }
  }

  async function handleReviewMediaModeration(
    mediaId: string,
    action: 'approve' | 'reject',
  ) {
    if (!user || !isAdmin || adminReviewMediaBusy) return
    if (action === 'reject') {
      const confirmation = await showConfirmation({
        title: '¿Rechazar este archivo?',
        text: 'Se eliminará de forma permanente y no se mostrará en la opinión.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Rechazar y eliminar',
        cancelButtonText: 'Volver',
        reverseButtons: true,
        customClass: {
          popup: 'lumina-alert-popup',
          title: 'lumina-alert-title',
          htmlContainer: 'lumina-alert-text',
          confirmButton: 'lumina-alert-confirm',
          cancelButton: 'lumina-alert-cancel',
          actions: 'lumina-alert-actions',
        },
        buttonsStyling: false,
      })
      if (!confirmation.isConfirmed) return
    }
    setAdminReviewMediaBusy(mediaId)
    setAdminError('')
    try {
      const result = await moderatePendingReviewMedia(user, mediaId, action)
      setPendingReviewMedia((current) => current.filter((media) => media.id !== mediaId))
      setNotice(result.message)
    } catch (error) {
      console.error('No se pudo moderar el archivo de una opinión.', error)
      setAdminError(error instanceof Error ? error.message : 'No se pudo moderar el archivo.')
    } finally {
      setAdminReviewMediaBusy('')
    }
  }

  async function handleAdminReviewDelete(review: AdminProductReview) {
    if (!user || !isAdmin || adminReviewDeleteBusy) return
    const confirmation = await showConfirmation({
      title: '¿Eliminar esta opinión?',
      text: 'Se quitará de la tienda y se eliminarán sus archivos adjuntos. Esta acción no se puede deshacer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar opinión',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      customClass: {
        popup: 'lumina-alert-popup',
        title: 'lumina-alert-title',
        htmlContainer: 'lumina-alert-text',
        confirmButton: 'lumina-alert-confirm',
        cancelButton: 'lumina-alert-cancel',
        actions: 'lumina-alert-actions',
      },
      buttonsStyling: false,
    })
    if (!confirmation.isConfirmed) return

    setAdminReviewDeleteBusy(review.id)
    setAdminError('')
    try {
      const result = await deleteAdminProductReview(user, review.id)
      setAdminProductReviews((current) => current.filter((item) => item.id !== review.id))
      setReviewSummaries((current) => ({
        ...current,
        [result.productId]: result.summary,
      }))
      setPendingReviewMedia((current) => current.filter((media) => media.reviewId !== review.id))
      setNotice(result.message)
    } catch (error) {
      console.error('No se pudo eliminar una opinión desde el panel de administración.', error)
      setAdminError(error instanceof Error ? error.message : 'No se pudo eliminar la opinión.')
    } finally {
      setAdminReviewDeleteBusy('')
    }
  }

  function handleEditAdminProduct(product: Product) {
    setAdminEditingProductId(product.id)
    setAdminProductDraft({
      id: product.id,
      name: product.name,
      category: product.category,
      description: product.description,
      price: String(product.price),
      originalPrice: product.originalPrice ? String(product.originalPrice) : '',
      stock: String(product.stock ?? 50),
      image: product.image,
      galleryImages: (product.images ?? []).filter((image) => image !== product.image).join('\n'),
      characteristics: product.characteristics ?? [],
      specifications: product.specifications ?? [],
    })
    setAdminTab('products')
  }

  async function handleToggleProductAvailability(product: Product) {
    if (!user || !isAdmin) return
    setAdminError('')
    try {
      const { db, firestoreSdk } = await getFirebaseServices()
      const ref = firestoreSdk.doc(db, 'products', product.id)
      const existing = await firestoreSdk.getDoc(ref)
      const nextActive = product.active === false
      await firestoreSdk.setDoc(
        ref,
        {
          id: product.id,
          name: product.name,
          category: product.category,
          description: product.description,
          price: product.price,
          image: product.image,
          imageTone: product.imageTone,
          stock: product.stock ?? 50,
          active: nextActive,
          updatedAt: firestoreSdk.serverTimestamp(),
          ...(!existing.exists() ? { createdAt: firestoreSdk.serverTimestamp() } : {}),
        },
        { merge: true },
      )
      setCatalog((current) =>
        current.map((item) => item.id === product.id ? { ...item, active: nextActive } : item),
      )
      setNotice(nextActive ? 'El producto volvió a estar disponible.' : 'El producto dejó de mostrarse en la tienda.')
    } catch (error) {
      console.error('No se pudo actualizar la disponibilidad del producto.')
      setAdminError(error instanceof Error ? error.message : 'No se pudo actualizar el producto.')
    }
  }

  async function handleAdminOrderStatus(orderId: string, status: 'preparing' | 'shipped' | 'delivered') {
    if (!user || !isAdmin) return
    try {
      await updateAdminOrderStatus(user, orderId, status)
      const orders = await loadAdminOrders(user)
      setAdminOrders(orders)
      setNotice('Se actualizó el estado del pedido.')
    } catch (error) {
      console.error('No se pudo actualizar el pedido desde administración.')
      setAdminError(error instanceof Error ? error.message : 'No se pudo actualizar el pedido.')
    }
  }

  async function handleAdminShipmentSave(event: FormEvent<HTMLFormElement>, orderId: string) {
    event.preventDefault()
    if (!user || !isAdmin || adminShipmentBusy) return
    const formData = new FormData(event.currentTarget)
    const shipmentType = formData.get('shipmentType')
    const shipmentStage = formData.get('shipmentStage')
    if (
      (shipmentType !== 'local' && shipmentType !== 'international') ||
      typeof shipmentStage !== 'string' ||
      ![
        'preparing',
        'international_transit',
        'customs',
        'in_argentina',
        'local_transit',
        'out_for_delivery',
        'delivered',
      ].includes(shipmentStage)
    ) {
      setAdminError('Seleccioná el tipo de envío y una etapa válida.')
      return
    }
    const shipment: AdminShipmentUpdate = {
      shipmentType,
      shipmentStage: shipmentStage as AdminShipmentUpdate['shipmentStage'],
      estimatedDeliveryStart: String(formData.get('estimatedDeliveryStart') ?? ''),
      estimatedDeliveryEnd: String(formData.get('estimatedDeliveryEnd') ?? ''),
      shipmentStageDetail: String(formData.get('shipmentStageDetail') ?? ''),
      trackingCarrier: String(formData.get('trackingCarrier') ?? ''),
      trackingCode: String(formData.get('trackingCode') ?? ''),
      trackingUrl: String(formData.get('trackingUrl') ?? ''),
    }
    setAdminShipmentBusy(orderId)
    setAdminError('')
    try {
      await updateAdminShipment(user, orderId, shipment)
      setAdminOrders(await loadAdminOrders(user))
      setNotice('Se actualizó el seguimiento y la fecha estimada.')
    } catch (error) {
      console.error('No se pudo actualizar el seguimiento del pedido.', error)
      setAdminError(error instanceof Error ? error.message : 'No se pudo actualizar el seguimiento.')
    } finally {
      setAdminShipmentBusy('')
    }
  }

  async function handleGrantAdminAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !isAdmin || adminUserBusy) return
    setAdminUserBusy(true)
    setAdminError('')
    try {
      const result = await grantAdminAccess(user, adminUserEmail)
      setAdminUserEmail('')
      setNotice(result.message)
    } catch (error) {
      console.error('No se pudieron asignar permisos de administración.')
      setAdminError(error instanceof Error ? error.message : 'No se pudieron asignar permisos de administración.')
    } finally {
      setAdminUserBusy(false)
    }
  }

  async function handleRevokeOwnAdminAccess() {
    if (!user || !isAdmin || adminRevokeBusy) return
    const confirmation = await showConfirmation({
      icon: 'warning',
      iconColor: '#a76f7d',
      title: '¿Quitar tu acceso?',
      text: 'Vas a dejar de administrar pedidos y productos. La página se actualizará para aplicar el cambio.',
      showCancelButton: true,
      showCloseButton: true,
      reverseButtons: true,
      focusCancel: true,
      confirmButtonText: 'Sí, quitar acceso',
      cancelButtonText: 'Seguir como admin',
      buttonsStyling: false,
      customClass: {
        popup: 'lumina-alert-popup',
        title: 'lumina-alert-title',
        htmlContainer: 'lumina-alert-message',
        actions: 'lumina-alert-actions',
        confirmButton: 'lumina-alert-confirm',
        cancelButton: 'lumina-alert-cancel',
        closeButton: 'lumina-alert-close',
      },
    })
    if (!confirmation.isConfirmed) return
    setAdminRevokeBusy(true)
    setAdminError('')
    try {
      await revokeOwnAdminAccess(user)
      window.location.reload()
    } catch (error) {
      console.error('No se pudo quitar el acceso propio de administración.', error)
      setAdminError(error instanceof Error ? error.message : 'No se pudo quitar el acceso de administración.')
      setAdminRevokeBusy(false)
    }
  }

  async function openAdminPanel() {
    setAdminLoading(true)
    setAdminError('')
    if (window.location.pathname !== '/admin') {
      window.history.pushState({ luminaAdmin: true }, '', '/admin')
    }
    if (adminTab === 'reviews') {
      setAdminReviewMediaLoading(true)
      setAdminReviewMediaRefresh((current) => current + 1)
    }
    setAdminOpen(true)
    try {
      await refreshCatalog()
    } catch (error) {
      console.error('No se pudo actualizar el catálogo del panel de administración.')
      setAdminError(error instanceof Error ? error.message : 'No se pudo actualizar el catálogo.')
    }
  }

  function closeAdminPanel() {
    window.history.replaceState({}, '', '/')
    setAdminOpen(false)
    setProductRouteId('')
  }

  async function handleSignOut() {
    if (!firebaseReady) return
    try {
      const { auth, authSdk } = await getFirebaseServices()
      await authSdk.signOut(auth)
      setAccountOpen(false)
      setNotice('Cerraste sesión')
    } catch (error) {
      console.error('No se pudo cerrar la sesión.', error)
      setAccountError('No se pudo cerrar la sesión. Intentá de nuevo.')
    }
  }

  function showCategory(category: string) {
    setActiveCategory(category)
    document.getElementById('productos')?.scrollIntoView({ behavior: 'smooth' })
  }

  async function handleCheckAdminAccess() {
    if (!user) return
    setAdminAccessStatus('checking')
    setAdminAccessError('')
    try {
      const hasAccess = await checkAdminAccess(user)
      setIsAdmin(hasAccess)
      setAdminAccessStatus(hasAccess ? 'admin' : 'not-admin')
    } catch (error) {
      console.error('No se pudo volver a comprobar el rol de administración.')
      setIsAdmin(false)
      setAdminAccessStatus('error')
      setAdminAccessError(error instanceof Error ? error.message : 'No se pudo verificar el acceso de administración.')
    }
  }

  function returnToStore() {
    const currentUrl = new URL(window.location.href)
    for (const param of [
      'payment',
      'order_id',
      'payment_id',
      'collection_id',
      'collection_status',
      'external_reference',
      'merchant_order_id',
      'status',
      'payment_type',
      'preference_id',
      'site_id',
      'processing_mode',
      'merchant_account_id',
    ]) currentUrl.searchParams.delete(param)
    window.history.replaceState(
      window.history.state,
      '',
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    )
    setPaymentReturnOrderId('')
  }

  if (paymentReturnOrderId && user) {
    return (
      <OrderStatusPage
        user={user}
        orderId={paymentReturnOrderId}
        order={paymentReturnOrder}
        status={paymentReturnStatus}
        message={paymentReturnMessage}
        onRefresh={() => {
          setPaymentReturnStatus('checking')
          setPaymentReturnMessage('')
          setPaymentRefreshCount((count) => count + 1)
        }}
        onBack={returnToStore}
        onViewPurchases={() => {
          returnToStore()
          setCustomerOrdersLoading(true)
          setCustomerOrdersError('')
          setCustomerOrdersPageOpen(true)
        }}
        onIncomingChatMessage={handleIncomingChatMessage}
        money={money}
      />
    )
  }
  if (customerOrdersPageOpen && user) {
    return (
      <CustomerOrdersPage
        orders={customerOrders}
        loading={customerOrdersLoading}
        error={customerOrdersError}
        money={money}
        onBack={() => setCustomerOrdersPageOpen(false)}
        onRefresh={() => {
          setCustomerOrdersLoading(true)
          setCustomerOrdersError('')
          setCustomerOrdersRefresh((current) => current + 1)
        }}
        onOpenOrder={(orderId) => {
          setCustomerOrdersPageOpen(false)
          setDeliveryCelebrationOrderId('')
          setSelectedCustomerOrderId(orderId)
          setSelectedCustomerOrderStatus('checking')
          setSelectedCustomerOrderMessage('')
        }}
      />
    )
  }
  if (selectedCustomerOrderId && user) {
    return (
      <OrderStatusPage
        user={user}
        orderId={selectedCustomerOrderId}
        order={selectedCustomerOrder?.id === selectedCustomerOrderId ? selectedCustomerOrder : null}
        status={selectedCustomerOrderStatus}
        message={selectedCustomerOrderMessage}
        onRefresh={() => {
          setSelectedCustomerOrderStatus('checking')
          setSelectedCustomerOrderMessage('')
          setSelectedCustomerOrderRefresh((current) => current + 1)
        }}
        onBack={() => {
          setSelectedCustomerOrderId('')
          setDeliveryCelebrationOrderId('')
          setCustomerOrdersPageOpen(true)
        }}
        onIncomingChatMessage={handleIncomingChatMessage}
        backLabel="Volver a mis compras"
        detailMode
        deliveryCelebration={deliveryCelebrationOrderId === selectedCustomerOrderId}
        money={money}
        onCancel={async () => {
          const result = await cancelCustomerOrder(user, selectedCustomerOrderId)
          setCustomerOrdersRefresh((current) => current + 1)
          return result
        }}
      />
    )
  }
  if (productRouteId) {
    const routeProduct = catalog.find((product) => product.id === productRouteId)
    if (!routeProduct) {
      return (
        <main className="product-route-message">
          <a className="wordmark" href="/">lúmina<span className="wordmark-star">✳</span></a>
          <h1>No encontramos este producto</h1>
          <p>Puede que ya no esté disponible o que el enlace no sea correcto.</p>
          <button className="button button-dark" type="button" onClick={closeProductDetails}>Volver a la tienda</button>
        </main>
      )
    }
    return (
      <ProductDetailPage
        key={routeProduct.id}
        product={routeProduct}
        summary={reviewSummaries[routeProduct.id] ?? { ratingAverage: 0, reviewCount: 0 }}
        user={user}
        emailVerified={emailVerified}
        disabled={storeLoading || authLoading}
        cartQuantity={cart[routeProduct.id] ?? 0}
        cartCount={cartCount}
        cartJustAdded={cartFeedbackProductId === routeProduct.id}
        onClose={closeProductDetails}
        onOpenCart={openProductCart}
        onAdd={addToCart}
        onLogin={openLoginForReview}
        onSummaryChange={handleReviewSummaryChange}
        relatedProducts={catalog.filter((product) => product.id !== routeProduct.id && product.category === routeProduct.category && product.active !== false)}
        onOpenProduct={openProductDetails}
      />
    )
  }

  return (
    <div className="storefront-enter" role={adminOpen ? undefined : 'main'}>
      <div
        className="announcement"
        role="region"
        aria-label="Avisos de Lúmina"
        aria-roledescription="carrusel"
        onMouseEnter={() => setAnnouncementPaused(true)}
        onMouseLeave={() => setAnnouncementPaused(false)}
        onFocusCapture={() => setAnnouncementPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setAnnouncementPaused(false)
          }
        }}
      >
        <Icon name="sparkles" size={15} />
        <p aria-live="polite" aria-atomic="true" key={announcementIndex}>{announcementMessages[announcementIndex]}</p>
        <div className="announcement-controls">
          <button
            type="button"
            aria-label="Aviso anterior"
            onClick={() => setAnnouncementIndex((current) => (current + announcementMessages.length - 1) % announcementMessages.length)}
          >
            <Icon name="arrow" size={13} />
          </button>
          <span>{String(announcementIndex + 1).padStart(2, '0')} / {String(announcementMessages.length).padStart(2, '0')}</span>
          <button
            type="button"
            aria-label="Siguiente aviso"
            onClick={() => setAnnouncementIndex((current) => (current + 1) % announcementMessages.length)}
          >
            <Icon name="arrow" size={13} />
          </button>
        </div>
      </div>

      <header className="site-header">
        <a className="wordmark" href="#inicio" aria-label="Lúmina, inicio">
          lúmina<span className="wordmark-star">✳</span>
        </a>
        <nav className="main-nav" aria-label="Categorías">
          {categories.slice(1).map((category) => (
            <button key={category} onClick={() => showCategory(category)}>
              {category}
            </button>
          ))}
          <a href="#novedades">Novedades</a>
        </nav>
        <div className={`header-actions${mobileSearchOpen ? ' mobile-search-open' : ''}`}>
          {isAdmin && (
            <button className="admin-shortcut" onClick={() => void openAdminPanel()} title="Abrir panel de administración">
              <Icon name="settings" size={16} /> Admin
            </button>
          )}
          <button
            className="icon-button mobile-search-toggle"
            type="button"
            aria-label={mobileSearchOpen ? 'Cerrar búsqueda' : 'Buscar productos'}
            aria-expanded={mobileSearchOpen}
            aria-controls="mobile-product-search"
            onClick={() => setMobileSearchOpen((current) => !current)}
          >
            <Icon name={mobileSearchOpen ? 'close' : 'search'} />
          </button>
          <label
            className={`search-box${mobileSearchOpen ? ' mobile-search-box-open' : ''}`}
            id="mobile-product-search"
          >
            <Icon name="search" size={19} />
            <input
              ref={searchInputRef}
              aria-label="Buscar productos"
              placeholder="¿Qué estás buscando?"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setMobileSearchOpen(false)
              }}
            />
            <kbd>Ctrl/⌘ K</kbd>
          </label>
          <NotificationCenter
            notifications={notificationStore.notifications}
            loading={notificationStore.loading}
            soundEnabled={notificationStore.soundEnabled}
            onMarkRead={notificationStore.markRead}
            onMarkAllRead={notificationStore.markAllRead}
            onClear={notificationStore.clearNotifications}
            onSoundChange={notificationStore.setSoundEnabled}
            onOpenOrder={(orderId) => {
              if (!user) return
              setCustomerOrdersPageOpen(false)
              setSelectedCustomerOrderId(orderId)
              setSelectedCustomerOrderStatus('checking')
              setSelectedCustomerOrderMessage('')
            }}
          />
          <ThemeToggleButton />
          <button
            className="icon-button account-button"
            aria-label={authLoading ? 'Verificando sesión' : user ? 'Abrir mi cuenta' : 'Ingresar a mi cuenta'}
            title={authLoading ? 'Verificando sesión' : user ? 'Mi cuenta' : 'Ingresar a mi cuenta'}
            disabled={authLoading}
            onClick={() => (user ? setAccountOpen(true) : setAuthOpen(true))}
          >
            {user
              ? <img className="header-account-avatar" src={getAccountAvatar(user.uid)} alt="" />
              : <Icon name="user" />}
          </button>
          <button
            className="icon-button bag-button"
            aria-label={cartCount ? `Abrir bolso, ${cartCount} productos` : 'Abrir bolso, vacío'}
            onClick={() => setCartOpen(true)}
          >
            <Icon name="bag" />
            {cartCount > 0 && <span className="bag-count">{cartCount}</span>}
          </button>
        </div>
      </header>

      <section className="hero" id="inicio">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> COLECCIÓN PRIMAVERA · 2026</span>
          <h1>Tu estilo,<br />tu pequeña <span>dosis de magia.</span></h1>
          <p>Accesorios que dicen mucho de vos. Encontrá ese detalle que convierte cualquier día en uno especial.</p>
          <a className="button button-dark" href="#productos">
            Explorar colección <Icon name="arrow" size={17} />
          </a>
          <div className="hero-note">
            <span className="benefit-icon"><Icon name="lock" size={16} /></span>
            <span><strong>Compra responsable</strong> · opiniones de compras verificadas</span>
          </div>
          <span className="hero-scribble" aria-hidden="true">✳</span>
        </div>
        <div
          className="hero-visual"
          aria-roledescription="carrusel"
          aria-label="Inspiración Lúmina"
        >
          <img
            key={heroSlides[heroSlideIndex].image}
            src={heroSlides[heroSlideIndex].image}
            alt={heroSlides[heroSlideIndex].alt}
            fetchPriority="high"
            decoding="async"
          />
          <div className="hero-sticker"><span>shine<br />your way</span><b>✳</b></div>
          <div className="hero-caption">
            <button type="button" onClick={() => setHeroSlideIndex((current) => (current + heroSlides.length - 1) % heroSlides.length)} aria-label="Imagen anterior">‹</button>
            <span>{String(heroSlideIndex + 1).padStart(2, '0')} / {String(heroSlides.length).padStart(2, '0')}</span>
            <span>{heroSlides[heroSlideIndex].caption}</span>
            <button type="button" onClick={() => setHeroSlideIndex((current) => (current + 1) % heroSlides.length)} aria-label="Siguiente imagen">›</button>
            <button type="button" onClick={() => setHeroPaused((paused) => !paused)} aria-label={heroPaused ? 'Reanudar carrusel automático' : 'Pausar carrusel automático'} aria-pressed={heroPaused}>
              {heroPaused ? '▶' : 'Ⅱ'}
            </button>
          </div>
        </div>
        <span className="hero-side-note">HECHO PARA BRILLAR · DESDE BUENOS AIRES</span>
      </section>

      <section className="benefit-strip" aria-label="Beneficios">
        <div><span className="benefit-icon" aria-hidden="true">$</span><span><strong>Total visible antes de pagar</strong><small>Precio y envío informados en el checkout</small></span></div>
        <div><span className="benefit-icon"><Icon name="lock" size={17} /></span><span><strong>Pago en Mercado Pago</strong><small>Checkout externo y seguro</small></span></div>
        <div><span className="benefit-icon">★</span><span><strong>Opiniones verificadas</strong><small>Solo de compras acreditadas</small></span></div>
      </section>

      <section className="category-discovery section-wrap" aria-labelledby="category-discovery-title">
        <div className="discovery-heading">
          <div><span className="eyebrow section-eyebrow">UN UNIVERSO PARA EXPLORAR</span><h2 id="category-discovery-title">¿Qué detalle buscás?</h2></div>
          <div className="discovery-actions">
            <button className="text-link shopping-guide-trigger" type="button" ref={shoppingGuideTriggerRef} onClick={() => setShoppingGuideOpen(true)}>
              ¿Primera vez? Cómo comprar
            </button>
            <a className="text-link" href="#productos">Ver todo el catálogo <Icon name="arrow" size={15} /></a>
          </div>
        </div>
        <div className="category-discovery-grid">
          {categories.slice(1).map((category) => {
            const categoryProduct = activeCatalog.find((product) => product.category === category)
            return (
              <button className="category-discovery-card" type="button" key={category} onClick={() => showCategory(category)}>
                {categoryProduct && <img src={categoryProduct.image} alt="" loading="lazy" />}
                <span><strong>{category}</strong><small>{categoryCounts[category]} piezas</small></span>
                <Icon name="arrow" size={17} />
              </button>
            )
          })}
        </div>
      </section>

      {!search.trim() && activeCategory === 'Todo' && (
        <>
          <ProductRail
            id="deals"
            title="Ofertas para aprovechar"
            description="Piezas elegidas con precios especiales por tiempo limitado."
            products={dealProducts}
            favorites={favorites}
            addedProductId={cartFeedbackProductId}
            reviewSummaries={reviewSummaries}
            disabled={storeLoading || authLoading}
            onFavorite={toggleFavorite}
            onAdd={addToCart}
            onOpenProduct={openProductDetails}
          />
          <ProductRail
            id="for-you"
            title={favorites.length ? 'Elegidos para vos' : 'Detalles para explorar'}
            description={favorites.length ? 'Ideas según las categorías de tus favoritos.' : 'Piezas de la colección para encontrar tu próximo detalle.'}
            products={personalizedProducts}
            favorites={favorites}
            addedProductId={cartFeedbackProductId}
            reviewSummaries={reviewSummaries}
            disabled={storeLoading || authLoading}
            onFavorite={toggleFavorite}
            onAdd={addToCart}
            onOpenProduct={openProductDetails}
          />
        </>
      )}

      <section className="collection section-wrap" id="productos">
        <div className="section-heading">
          <div>
            <span className="eyebrow section-eyebrow">UN MUNDO DE DETALLES</span>
            <h2>Encontrá tu <span>próximo favorito</span></h2>
            <p className="collection-intro">Explorá accesorios, bijou y bolsos elegidos para acompañar tu estilo.</p>
          </div>
          <span className="collection-total">{categoryCounts.Todo} productos disponibles</span>
        </div>
        <div className="category-tabs" role="group" aria-label="Filtrar por categoría">
          {categories.map((category) => (
            <button
              className={activeCategory === category ? 'category-tab active' : 'category-tab'}
              key={category}
              onClick={() => setActiveCategory(category)}
              aria-pressed={activeCategory === category}
            >
              {category}<span className="category-tab-count">{categoryCounts[category]}</span>
            </button>
          ))}
        </div>
        <div className="catalog-toolbar">
          <span className="result-count" aria-live="polite">
            {visibleProducts.length} {visibleProducts.length === 1 ? 'producto' : 'productos'}
          </span>
          <button
            className={`sale-filter ${saleOnly ? 'active' : ''}`}
            onClick={() => setSaleOnly((current) => !current)}
            aria-pressed={saleOnly}
          >
            Ofertas
          </button>
          <label className="sort-control">
            <span>Ordenar por</span>
            <select
              value={productSort}
              onChange={(event) => {
                if (isProductSort(event.currentTarget.value)) {
                  setProductSort(event.currentTarget.value)
                }
              }}
              aria-label="Ordenar productos"
            >
              <option value="recommended">Recomendados</option>
              <option value="newest">Novedades</option>
              <option value="rating">Mejor puntuados</option>
              <option value="price-asc">Menor precio</option>
              <option value="price-desc">Mayor precio</option>
            </select>
          </label>
        </div>
        {reviewSummaryError && <p className="review-summary-warning" role="status">{reviewSummaryError}</p>}

        {visibleProducts.length ? (
          <div className="product-grid">
            {visibleProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                summary={reviewSummaries[product.id] ?? emptyReviewSummary}
                isFavorite={favorites.includes(product.id)}
                addedToCart={cartFeedbackProductId === product.id}
                disabled={storeLoading || authLoading}
                onFavorite={toggleFavorite}
                onAdd={addToCart}
                onOpen={openProductDetails}
              />
            ))}
          </div>
        ) : (
          <div className="empty-results">
            <span>✳</span><h3>No encontramos ese detalle</h3>
            <p>Probá con otra búsqueda o explorá todas las piezas.</p>
            <button className="text-link" onClick={() => { setSearch(''); setActiveCategory('Todo'); setSaleOnly(false) }}>Ver toda la colección</button>
          </div>
        )}
      </section>

      <section className="inspiration" id="novedades">
        <div className="inspiration-image">
          <img src="https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1000&q=85" alt="Inspiración de accesorios dorados para combinar" loading="lazy" />
          <span className="image-caption">UN TOQUE DE COLOR CAMBIA TODO</span>
        </div>
        <div className="inspiration-copy">
          <span className="eyebrow section-eyebrow">TU MOMENTO, TU ESTILO</span>
          <h2>Las reglas las<br />ponés <span>vos.</span></h2>
          <p>Mezclá, combiná, probá. Nuestros accesorios están para acompañar todas tus versiones.</p>
          <a className="button button-outline" href="#productos">Encontrá tu combinación <Icon name="arrow" size={17} /></a>
          <span className="inspiration-doodle" aria-hidden="true">♡</span>
        </div>
      </section>

      <section className="newsletter">
        <span className="newsletter-star">✳</span>
        <span className="eyebrow">COMPRÁ CON INFORMACIÓN CLARA</span>
        <h2>Elegí con calma,<br /><span>comprá con confianza.</span></h2>
        <p>Revisá materiales, precio, disponibilidad y opiniones verificadas antes de decidir.</p>
        <a className="button button-dark" href="#productos">Volver al catálogo <Icon name="arrow" size={17} /></a>
        <small>Las opiniones solo se habilitan luego de una compra aprobada.</small>
      </section>

      <footer className="site-footer">
        <div className="footer-top">
          <a className="wordmark footer-wordmark" href="#inicio">lúmina<span className="wordmark-star">✳</span></a>
          <p>Un detalle, todo tu estilo.<br />Hecho con amor en Buenos Aires.</p>
          <div className="footer-links"><a href="#productos">La colección</a><a href="#novedades">Nuestra inspiración</a><button onClick={() => (user ? setAccountOpen(true) : setAuthOpen(true))}>Mi cuenta</button></div>
          <span className="social-note">Atención responsable · Lúmina</span>
        </div>
        <div className="footer-bottom"><span>© 2026 Lúmina. Todos los detalles reservados.</span><span>Hecho para brillar <b>✳</b></span></div>
      </footer>

      {notice && <div className="toast" role="status"><Icon name="check" size={18} />{notice}</div>}

      {authOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false) }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="modal-close icon-button" onClick={() => setAuthOpen(false)} aria-label="Cerrar"><Icon name="close" /></button>
            <span className="auth-mark">✳</span>
            <span className="eyebrow section-eyebrow">TU ESPACIO LÚMINA</span>
            <h2 id="auth-title">
              {authMode === 'login' ? 'Qué lindo verte' : authMode === 'register' ? 'Sumate al brillo' : 'Recuperá tu cuenta'}
            </h2>
            <p>
              {authMode === 'login'
                ? 'Ingresá a tu cuenta y seguí donde dejaste.'
                : authMode === 'register'
                  ? 'Creá tu cuenta para guardar tus favoritos. Te vamos a enviar un email para verificarla.'
                  : 'Ingresá el email de tu cuenta y te mandamos un enlace para crear una contraseña nueva.'}
            </p>
            {!firebaseReady && <div className="firebase-hint"><Icon name="lock" size={16} /> Autenticación disponible al conectar Firebase en <code>.env.local</code>.</div>}
            <form onSubmit={handleAuthSubmit}>
              {authMode === 'register' && <label>Tu nombre<input name="name" autoComplete="name" placeholder="¿Cómo te llamás?" required /></label>}
              <label>
                {authMode === 'reset' ? 'Email de tu cuenta' : 'Email'}
                <input id="auth-email" name="email" type="email" autoComplete="email" placeholder="hola@ejemplo.com" required />
              </label>
              {authMode !== 'reset' && <label>Contraseña<input name="password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="Mínimo 6 caracteres" minLength={6} required /></label>}
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="button button-dark auth-submit" type="submit" disabled={authBusy}>
              {authBusy ? <><span className="button-spinner" aria-hidden="true" /> Un segundo…</> : <>{authMode === 'login' ? 'Ingresar' : authMode === 'register' ? 'Crear mi cuenta' : 'Enviar enlace de recuperación'}<Icon name="arrow" size={17} /></>}
              </button>
            </form>
            {authMode === 'login' && (
              <button className="password-reset" onClick={() => { setAuthMode('reset'); setAuthError('') }} disabled={authBusy}>
                ¿Olvidaste tu contraseña?
              </button>
            )}
            {authMode === 'reset' ? (
              <button className="auth-switch" onClick={() => { setAuthMode('login'); setAuthError('') }} disabled={authBusy}>
                Volver a <strong>Ingresar</strong>
              </button>
            ) : (
              <button className="auth-switch" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>
                {authMode === 'login' ? '¿Todavía no tenés cuenta? ' : '¿Ya tenés cuenta? '}
                <strong>{authMode === 'login' ? 'Registrate' : 'Ingresá'}</strong>
              </button>
            )}
          </section>
        </div>
      )}

      {accountOpen && user && (
        <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccountOpen(false) }}>
          <aside className="account-drawer" role="dialog" aria-modal="true" aria-labelledby="account-title">
            <div className="drawer-heading">
              <div>
                <span className="eyebrow section-eyebrow">TU ESPACIO LÚMINA</span>
                <h2 id="account-title">Mi cuenta</h2>
              </div>
              <button className="icon-button" onClick={() => setAccountOpen(false)} aria-label="Cerrar mi cuenta"><Icon name="close" /></button>
            </div>
            <div className="account-welcome">
              <img
                className="account-avatar"
                src={getAccountAvatar(user.uid)}
                alt=""
                aria-hidden="true"
              />
              <div>
                <span>¡Hola{customerProfile.name || user.displayName ? ',' : ''}</span>
                <h3>{customerProfile.name || user.displayName || user.email?.split('@')[0] || 'qué lindo verte'}</h3>
                <p>{user.email}</p>
              </div>
            </div>
            {adminAccessStatus === 'error' && (
              <div className="admin-access-notice has-error" role="alert">
                <p>{adminAccessError}</p>
                <button type="button" onClick={() => void handleCheckAdminAccess()}>Volver a comprobar</button>
              </div>
            )}
            <section className="customer-profile-summary" aria-labelledby="customer-profile-title">
              <div className="profile-summary-top">
                <div>
                  <span className="eyebrow section-eyebrow">TU PERFIL</span>
                  <h3 id="customer-profile-title">Datos personales</h3>
                </div>
                <strong>{profileCompletion}%</strong>
              </div>
              <div
                className="profile-progress-track"
                role="progressbar"
                aria-label="Perfil completado"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={profileCompletion}
              >
                <span style={{ width: `${profileCompletion}%` }} />
              </div>
              <div className="profile-summary-bottom">
                <p>{customerProfileLoading ? 'Cargando tu perfil…' : profileCompletion === 100 ? '¡Tu perfil está completo!' : 'Completá tus datos para agilizar tus compras.'}</p>
                <button type="button" onClick={openProfileEditor} disabled={customerProfileLoading}>
                  Editar <Icon name="arrow" size={14} />
                </button>
              </div>
              {customerProfileError && <p className="profile-form-error" role="alert">{customerProfileError}</p>}
            </section>
            {!emailVerified && (
              <section className="verification-card" aria-labelledby="verification-title">
                <span className="verification-icon"><Icon name="lock" size={18} /></span>
                <div className="verification-copy">
                  <h3 id="verification-title">Verificá tu email</h3>
                  <p>Enviamos un enlace a <strong>{user.email}</strong>. Podés seguir explorando mientras tanto.</p>
                  <div className="verification-actions">
                    <button onClick={() => void handleResendVerification()} disabled={authBusy}>
                      {authBusy ? 'Enviando…' : 'Reenviar email'}
                    </button>
                    <button onClick={() => void handleCheckVerification()} disabled={profileBusy}>
                      {profileBusy ? 'Comprobando…' : 'Ya lo verifiqué'}
                    </button>
                  </div>
                </div>
              </section>
            )}
            {accountError && (
              <div className="account-error" role="alert">
                <p>{accountError}</p>
                <button onClick={() => void handleRetryProfile()} disabled={profileBusy}>
                  {profileBusy ? 'Revisando…' : 'Reintentar perfil'}
                </button>
              </div>
            )}
            {storeLoading && <p className="account-sync-status"><span className="sync-indicator" aria-hidden="true" />Estamos sincronizando tus favoritos y tu bolso…</p>}
            <div className="account-shortcuts">
              <button onClick={() => { setAccountOpen(false); setCartOpen(true) }}>
                <Icon name="bag" size={19} /><span><strong>Mi bolso</strong><small>{cartCount} {cartCount === 1 ? 'producto' : 'productos'}</small></span><Icon name="arrow" size={16} />
              </button>
              <div className="account-favorite-count">
                <Icon name="heart" size={19} /><span><strong>Mis favoritos</strong><small>{favoriteProducts.length} {favoriteProducts.length === 1 ? 'pieza guardada' : 'piezas guardadas'}</small></span>
              </div>
            </div>
            <button
              className="account-purchases-link"
              type="button"
              onClick={() => {
                setAccountOpen(false)
                setCustomerOrdersLoading(true)
                setCustomerOrdersError('')
                setCustomerOrdersPageOpen(true)
              }}
            >
              <Icon name="box" size={19} />
              <span>
                <strong>Mis compras</strong>
                <small>{customerOrders.length} {customerOrders.length === 1 ? 'pedido' : 'pedidos'}</small>
              </span>
              <Icon name="arrow" size={16} />
            </button>
            <section className="account-favorites">
              <div className="account-section-heading">
                <h3>Guardados para vos</h3>
                {favoriteProducts.length > 0 && <span>{favoriteProducts.length}</span>}
              </div>
              {favoriteProducts.length ? (
                <div className="account-favorite-list">
                  {favoriteProducts.map((product) => (
                    <article className="account-favorite-item" key={product.id}>
                      <img src={product.image} alt="" />
                      <div>
                        <span>{product.category}</span>
                        <h4>{product.name}</h4>
                        <strong>{money.format(product.price)}</strong>
                      </div>
                      <button className="icon-button" aria-label={`Quitar ${product.name} de favoritos`} onClick={() => toggleFavorite(product.id)}><Icon name="close" size={17} /></button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="account-empty-favorites">
                  <p>Todavía no guardaste favoritos. Tocá el corazón de una pieza para encontrarla acá.</p>
                  <button className="text-link" onClick={() => { setAccountOpen(false); document.getElementById('productos')?.scrollIntoView({ behavior: 'smooth' }) }}>Explorar la colección <Icon name="arrow" size={15} /></button>
                </div>
              )}
            </section>
            <div className="account-footer">
              <span><Icon name="lock" size={15} /> Sesión segura con Firebase</span>
              <button onClick={() => void handleSignOut()}>Cerrar sesión <Icon name="arrow" size={15} /></button>
            </div>
          </aside>
        </div>
      )}

      {profileEditorOpen && user && (
        <div className="profile-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !profileBusy) setProfileEditorOpen(false) }}>
          <section className="profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
            <div className="profile-editor-heading">
              <div>
                <span className="eyebrow section-eyebrow">TU ESPACIO LÚMINA</span>
                <h2 id="profile-editor-title">Personalizá tu perfil</h2>
                <p>Guardá tus datos para tenerlos listos cuando hagas tu primera compra.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setProfileEditorOpen(false)} aria-label="Cerrar edición de perfil" disabled={profileBusy}><Icon name="close" /></button>
            </div>
            {customerProfileLoading ? (
              <p className="account-sync-status"><span className="sync-indicator" aria-hidden="true" />Cargando tus datos…</p>
            ) : (
              <form className="customer-profile-form profile-editor-form" onSubmit={handleCustomerProfileSave}>
                <label>
                  Nombre y apellido
                  <input name="profile-name" autoComplete="name" value={customerProfileDraft.name} onChange={(event) => setCustomerProfileDraft((current) => ({ ...current, name: event.target.value }))} maxLength={80} required />
                </label>
                <label>
                  Teléfono
                  <input name="phone" type="tel" autoComplete="tel" placeholder="11 1234 5678" value={customerProfileDraft.phone} onChange={(event) => setCustomerProfileDraft((current) => ({ ...current, phone: event.target.value }))} maxLength={30} required />
                </label>
                <label className="profile-editor-full">
                  Calle y número
                  <input name="address" autoComplete="street-address" placeholder="Ej.: Av. Corrientes 1234" value={customerProfileDraft.address} onChange={(event) => setCustomerProfileDraft((current) => ({ ...current, address: event.target.value }))} maxLength={120} required />
                </label>
                <label className="profile-editor-full">
                  Piso / departamento <span className="profile-optional">(opcional)</span>
                  <input name="apartment" autoComplete="address-line2" placeholder="Ej.: 3° B" value={customerProfileDraft.apartment} onChange={(event) => setCustomerProfileDraft((current) => ({ ...current, apartment: event.target.value }))} maxLength={60} />
                </label>
                <label>
                  Localidad
                  <input name="city" autoComplete="address-level2" value={customerProfileDraft.city} onChange={(event) => setCustomerProfileDraft((current) => ({ ...current, city: event.target.value }))} maxLength={80} required />
                </label>
                <label>
                  Provincia
                  <input name="province" autoComplete="address-level1" value={customerProfileDraft.province} onChange={(event) => setCustomerProfileDraft((current) => ({ ...current, province: event.target.value }))} maxLength={80} required />
                </label>
                <label>
                  Código postal
                  <input name="postalCode" autoComplete="postal-code" value={customerProfileDraft.postalCode} onChange={(event) => setCustomerProfileDraft((current) => ({ ...current, postalCode: event.target.value }))} maxLength={20} required />
                </label>
                {customerProfileError && <p className="profile-form-error profile-editor-full" role="alert">{customerProfileError}</p>}
                <div className="profile-editor-actions profile-editor-full">
                  <button className="auth-switch" type="button" onClick={() => setProfileEditorOpen(false)} disabled={profileBusy}>Cancelar</button>
                  <button className="button button-dark profile-save-button" type="submit" disabled={profileBusy}>
                    {profileBusy ? <><span className="button-spinner" aria-hidden="true" /> Guardando…</> : 'Guardar mis datos'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      {checkoutOpen && user && (
        <div className="checkout-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !checkoutBusy) setCheckoutOpen(false) }}>
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            <div className="profile-editor-heading">
              <div>
                <span className="eyebrow section-eyebrow">PAGO SEGURO · MERCADO PAGO</span>
                <h2 id="checkout-title">Coordinemos tu pedido</h2>
                <p>Completá los datos de entrega. Luego vas a continuar en Mercado Pago para realizar el pago.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setCheckoutOpen(false)} aria-label="Cerrar checkout" disabled={checkoutBusy}><Icon name="close" /></button>
            </div>
            <form className="checkout-form" onSubmit={(event) => void handleMercadoPagoCheckout(event)}>
              <div className="checkout-fields">
                <label>Nombre y apellido<input name="shipping-name" autoComplete="name" defaultValue={checkoutShipping.name} required maxLength={80} /></label>
                <label>Teléfono<input name="shipping-phone" type="tel" autoComplete="tel" defaultValue={checkoutShipping.phone} required maxLength={30} /></label>
                <label className="checkout-field-full">Calle y número<input name="shipping-address" autoComplete="street-address" defaultValue={checkoutShipping.address} required maxLength={120} /></label>
                <label className="checkout-field-full">Piso / departamento (opcional)<input name="shipping-apartment" autoComplete="address-line2" defaultValue={checkoutShipping.apartment} maxLength={60} /></label>
                <label>Localidad<input name="shipping-city" autoComplete="address-level2" defaultValue={checkoutShipping.city} required maxLength={80} /></label>
                <label>Provincia<input name="shipping-province" autoComplete="address-level1" defaultValue={checkoutShipping.province} required maxLength={80} /></label>
                <label>Código postal<input name="shipping-postal" autoComplete="postal-code" defaultValue={checkoutShipping.postalCode} required maxLength={20} /></label>
              </div>
              <div className="checkout-totals">
                <div><span>{cartCount} {cartCount === 1 ? 'producto' : 'productos'}</span><strong>{money.format(cartTotal)}</strong></div>
                <div><span>Envío</span><strong>{estimatedShipping ? money.format(estimatedShipping) : 'Gratis'}</strong></div>
                <div className="checkout-grand-total"><span>Total a pagar</span><strong>{money.format(cartTotal + estimatedShipping)}</strong></div>
              </div>
              {checkoutError && <p className="profile-form-error" role="alert">{checkoutError}</p>}
              <button className="button button-dark profile-save-button" type="submit" disabled={checkoutBusy}>
                {checkoutBusy ? <><span className="button-spinner" aria-hidden="true" /> Preparando pago…</> : 'Continuar a Mercado Pago'}
                {!checkoutBusy && <Icon name="arrow" size={17} />}
              </button>
              <p className="checkout-disclaimer">El estado del pedido se confirma cuando Mercado Pago notifica el resultado al servidor.</p>
            </form>
          </section>
        </div>
      )}

      {adminOpen && user && isAdmin && createPortal(
        <div
          className="admin-backdrop"
          data-admin-text={adminAccessibility.textScale}
          data-admin-contrast={adminAccessibility.highContrast ? 'high' : 'normal'}
          data-admin-motion={adminAccessibility.reduceMotion ? 'reduced' : 'full'}
          data-admin-focus={adminAccessibility.visibleFocus ? 'visible' : 'standard'}
          data-admin-density={adminAccessibility.compactLayout ? 'compact' : 'comfortable'}
        >
          <a className="admin-skip-link" href="#admin-main">Ir al contenido principal</a>
          <section ref={adminDashboardRef} className="admin-dashboard" aria-labelledby="admin-title" tabIndex={-1}>
            <header className="admin-dashboard-header">
              <a className="admin-brand" href="/" aria-label="Volver a la tienda Lúmina">
                <span className="admin-brand-mark">l<span>✳</span></span>
                <span>ADMIN<span className="admin-brand-divider">/</span>LÚMINA</span>
              </a>
              <div className="admin-dashboard-heading">
                <span className="eyebrow section-eyebrow">ESPACIO DE GESTIÓN</span>
                <h1 id="admin-title">Administración</h1>
                <p>Un lugar claro para cuidar cada detalle de la tienda.</p>
              </div>
              <div className="admin-header-actions">
                <span className="admin-session-label"><span aria-hidden="true" /> Sesión segura</span>
                <ThemeToggleButton />
                <a className="admin-store-link" href="/" aria-label="Volver a la tienda">Ir a la tienda <Icon name="arrow" size={15} /></a>
              </div>
            </header>
            <div className="admin-workspace">
              <aside className="admin-sidebar" aria-label="Navegación y accesibilidad">
                <div className="admin-sidebar-section">
                  <span className="admin-sidebar-label">TIENDA</span>
                  <nav className="admin-tabs" aria-label="Secciones de administración">
                    <button aria-current={adminTab === 'orders' ? 'page' : undefined} className={adminTab === 'orders' ? 'active' : ''} onClick={() => setAdminTab('orders')}><Icon name="bag" size={17} /> <span>Pedidos</span><b>{adminOrders.length}</b></button>
                    <button aria-current={adminTab === 'reviews' ? 'page' : undefined} className={adminTab === 'reviews' ? 'active' : ''} onClick={() => { setAdminError(''); setAdminReviewMediaLoading(true); setAdminProductReviewsLoading(true); setAdminReviewMediaCursor(''); setAdminProductReviewsCursor(''); setAdminReviewMediaRefresh((current) => current + 1); setAdminTab('reviews') }}><Icon name="sparkles" size={17} /> <span>Opiniones</span><b>{adminProductReviews.length}</b></button>
                    <button aria-current={adminTab === 'products' ? 'page' : undefined} className={adminTab === 'products' ? 'active' : ''} onClick={() => setAdminTab('products')}><Icon name="box" size={17} /> <span>Productos</span><b>{catalog.filter((product) => product.active !== false).length}</b></button>
                    <button aria-current={adminTab === 'categories' ? 'page' : undefined} className={adminTab === 'categories' ? 'active' : ''} onClick={() => { setAdminCategoryError(''); setAdminTab('categories') }}><Icon name="box" size={17} /> <span>Categorías</span><b>{categories.length - 1}</b></button>
                    <button aria-current={adminTab === 'access' ? 'page' : undefined} className={adminTab === 'access' ? 'active' : ''} onClick={() => setAdminTab('access')}><Icon name="user" size={17} /> <span>Accesos</span></button>
                  </nav>
                </div>
                <details className="admin-accessibility" open>
                  <summary><Icon name="settings" size={17} /> Accesibilidad <span>Preferencias</span></summary>
                  <div className="admin-accessibility-controls">
                    <fieldset className="admin-accessibility-field">
                      <legend>Tamaño del texto</legend>
                      <div className="admin-choice-group" role="group" aria-label="Tamaño del texto">
                        {([
                          ['normal', 'Normal'],
                          ['large', 'Grande'],
                          ['largest', 'Más grande'],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={adminAccessibility.textScale === value ? 'is-selected' : ''}
                            aria-pressed={adminAccessibility.textScale === value}
                            onClick={() => setAdminAccessibility((current) => ({ ...current, textScale: value }))}
                          >{label}</button>
                        ))}
                      </div>
                    </fieldset>
                    <label className="admin-accessibility-switch">
                      <span><strong>Alto contraste</strong><small>Refuerza texto y límites</small></span>
                      <input type="checkbox" checked={adminAccessibility.highContrast} onChange={(event) => setAdminAccessibility((current) => ({ ...current, highContrast: event.target.checked }))} />
                    </label>
                    <label className="admin-accessibility-switch">
                      <span><strong>Reducir movimiento</strong><small>Minimiza animaciones</small></span>
                      <input type="checkbox" checked={adminAccessibility.reduceMotion} onChange={(event) => setAdminAccessibility((current) => ({ ...current, reduceMotion: event.target.checked }))} />
                    </label>
                    <label className="admin-accessibility-switch">
                      <span><strong>Resaltar foco</strong><small>Contorno visible al navegar</small></span>
                      <input type="checkbox" checked={adminAccessibility.visibleFocus} onChange={(event) => setAdminAccessibility((current) => ({ ...current, visibleFocus: event.target.checked }))} />
                    </label>
                    <label className="admin-accessibility-switch">
                      <span><strong>Vista compacta</strong><small>Más información por pantalla</small></span>
                      <input type="checkbox" checked={adminAccessibility.compactLayout} onChange={(event) => setAdminAccessibility((current) => ({ ...current, compactLayout: event.target.checked }))} />
                    </label>
                  </div>
                </details>
                <button className="admin-exit-button" type="button" onClick={closeAdminPanel}>Salir del panel <Icon name="arrow" size={15} /></button>
              </aside>
              <main className="admin-main" id="admin-main" tabIndex={-1}>
                <div className="admin-main-topline">
                  <div>
                    <span className="admin-main-kicker">LÚMINA · {adminTab === 'orders' ? 'OPERACIONES' : adminTab === 'reviews' ? 'COMUNIDAD' : adminTab === 'products' || adminTab === 'categories' ? 'CATÁLOGO' : 'EQUIPO'}</span>
                    <h2>{adminTab === 'orders' ? 'Pedidos' : adminTab === 'reviews' ? 'Opiniones' : adminTab === 'products' ? 'Productos' : adminTab === 'categories' ? 'Categorías' : 'Accesos'}</h2>
                  </div>
                  <span className="admin-main-account"><Icon name="user" size={16} /> {user.email ?? 'Administrador'}</span>
                </div>
                {adminError && <p className="profile-form-error admin-error" role="alert">{adminError}</p>}
                {adminTab === 'orders' ? (
              <section className="admin-orders">
                <div className="admin-section-heading">
                  <div><h3>Ventas recientes</h3><p>Se actualiza automáticamente cada 12 segundos mientras el panel está abierto.</p></div>
                  {adminLoading && <span className="sync-indicator" aria-label="Actualizando pedidos" />}
                </div>
                {adminOrders.length ? adminOrders.map((order) => (
                  <article className="admin-order-card" key={order.id}>
                    <div className="admin-order-heading">
                      <div><span className="admin-order-id">Pedido {order.id.slice(0, 8).toLocaleUpperCase('es-AR')}</span><small>{order.createdAt?._seconds ? new Date(order.createdAt._seconds * 1000).toLocaleString('es-AR') : 'Pedido reciente'}</small></div>
                      <span className={`admin-order-status status-${order.status}`}>{order.status === 'pending_payment' ? 'Pago pendiente' : order.status === 'payment_failed' ? 'Pago no completado' : order.status === 'payment_expired' ? 'Pago vencido' : order.status === 'payment_review' ? 'Revisión necesaria' : order.status === 'new' ? 'Nuevo' : order.status === 'preparing' ? 'Preparando' : order.status === 'shipped' ? 'Enviado' : order.status === 'delivered' ? 'Entregado' : order.status}</span>
                    </div>
                    <div className="admin-order-customer"><strong>{order.customerName}</strong><span>{order.customerEmail}</span><span>{order.shipping.address}{order.shipping.apartment ? `, ${order.shipping.apartment}` : ''}, {order.shipping.city}, {order.shipping.province} {order.shipping.postalCode}</span></div>
                    <div className="admin-order-items">{order.items.map((item) => <div key={item.id}><span>{item.quantity} × {item.name}</span><strong>{money.format(item.lineTotal)}</strong></div>)}</div>
                    <div className="admin-order-total"><span>{order.paymentStatus === 'approved' ? 'Pago acreditado' : order.paymentStatus === 'pending' ? 'Esperando confirmación de pago' : `Pago: ${order.paymentStatus}`} · envío {order.shippingCost ? money.format(order.shippingCost) : 'gratis'}</span><strong>{money.format(order.total)}</strong></div>
                    {order.paymentStatus === 'approved' && (
                      <details className="admin-shipment-editor">
                        <summary>Configurar envío y seguimiento</summary>
                        <form onSubmit={(event) => void handleAdminShipmentSave(event, order.id)}>
                          <label>
                            Tipo de envío
                            <select name="shipmentType" defaultValue={order.shipmentType ?? 'local'}>
                              <option value="local">Local</option>
                              <option value="international">Internacional</option>
                            </select>
                          </label>
                          <label>
                            Etapa actual
                            <select name="shipmentStage" defaultValue={order.shipmentStage ?? (order.status === 'shipped' ? 'local_transit' : order.status === 'delivered' ? 'delivered' : order.status === 'preparing' ? 'preparing' : 'preparing')}>
                              <option value="preparing">En preparación</option>
                              <option value="international_transit">En camino desde el exterior</option>
                              <option value="customs">En aduana</option>
                              <option value="in_argentina">En Argentina</option>
                              <option value="local_transit">En camino al domicilio</option>
                              <option value="out_for_delivery">En reparto</option>
                              <option value="delivered">Entregada</option>
                            </select>
                          </label>
                          <label>Fecha estimada desde<input name="estimatedDeliveryStart" type="date" defaultValue={order.estimatedDeliveryStart ?? ''} required /></label>
                          <label>Fecha estimada hasta<input name="estimatedDeliveryEnd" type="date" defaultValue={order.estimatedDeliveryEnd ?? ''} required /></label>
                          <label className="admin-shipment-full">Novedad visible para el cliente<input name="shipmentStageDetail" defaultValue={order.shipmentStageDetail ?? ''} maxLength={240} placeholder="Ej.: Tu paquete ya salió de aduana." /></label>
                          <label>Correo / transportista<input name="trackingCarrier" defaultValue={order.trackingCarrier ?? ''} maxLength={80} placeholder="Correo Argentino, Andreani…" /></label>
                          <label>Código de seguimiento<input name="trackingCode" defaultValue={order.trackingCode ?? ''} maxLength={80} /></label>
                          <label className="admin-shipment-full">Enlace de seguimiento<input name="trackingUrl" type="url" defaultValue={order.trackingUrl ?? ''} placeholder="https://…" /></label>
                          <button className="admin-order-action admin-shipment-save" type="submit" disabled={adminShipmentBusy === order.id}>
                            {adminShipmentBusy === order.id ? 'Guardando…' : 'Guardar seguimiento'}
                          </button>
                        </form>
                      </details>
                    )}
                    {order.paymentStatus === 'approved' && order.status === 'new' && <button className="admin-order-action" onClick={() => void handleAdminOrderStatus(order.id, 'preparing')}>Preparar pedido <Icon name="arrow" size={15} /></button>}
                    {order.paymentStatus === 'approved' && order.status === 'preparing' && <button className="admin-order-action" onClick={() => void handleAdminOrderStatus(order.id, 'shipped')}>Marcar como enviado <Icon name="arrow" size={15} /></button>}
                    {order.paymentStatus === 'approved' && order.status === 'shipped' && <button className="admin-order-action" onClick={() => void handleAdminOrderStatus(order.id, 'delivered')}>Marcar como entregado <Icon name="check" size={15} /></button>}
                    {order.paymentStatus === 'approved' && (
                      <details
                        className="admin-order-messages"
                        onToggle={(event) => {
                          const isOpen = event.currentTarget.open
                          setAdminMessageThreads((current) => ({ ...current, [order.id]: isOpen }))
                        }}
                      >
                        <summary>Mensajes con el cliente</summary>
                        {adminMessageThreads[order.id] && (
                          <OrderMessages user={user} orderId={order.id} isAdmin />
                        )}
                      </details>
                    )}
                  </article>
                )) : !adminLoading && <div className="admin-empty"><Icon name="bag" size={28} /><h3>Todavía no hay pedidos</h3><p>Los pedidos con su estado de pago y datos de entrega aparecerán acá.</p></div>}
              </section>
            ) : adminTab === 'reviews' ? (
              <section className="admin-review-media">
                <div className="admin-section-heading">
                  <div><h3>Opiniones de compradores</h3><p>Revisá las opiniones publicadas y eliminá las que no deban permanecer visibles. Los archivos nuevos requieren aprobación antes de publicarse.</p></div>
                  {(adminReviewMediaLoading || adminProductReviewsLoading) && <span className="sync-indicator" aria-label="Actualizando opiniones y archivos pendientes" />}
                  <button type="button" className="auth-switch admin-review-media-refresh" onClick={() => { setAdminError(''); setAdminReviewMediaLoading(true); setAdminProductReviewsLoading(true); setAdminReviewMediaCursor(''); setAdminProductReviewsCursor(''); setAdminReviewMediaRefresh((current) => current + 1) }} disabled={adminReviewMediaLoading || adminProductReviewsLoading}>Actualizar</button>
                </div>
                {adminProductReviews.length ? adminProductReviews.map((review) => (
                  <article className="admin-review-entry" key={review.id}>
                    <div className="admin-review-entry-heading">
                      <div>
                        <strong>{review.productName}</strong>
                        <span>{review.createdAt ? new Date(review.createdAt).toLocaleString('es-AR') : 'Opinión verificada'} · {review.rating}/5 estrellas</span>
                      </div>
                      <button
                        type="button"
                        className="admin-review-media-reject"
                        onClick={() => void handleAdminReviewDelete(review)}
                        disabled={Boolean(adminReviewDeleteBusy)}
                      >
                        {adminReviewDeleteBusy === review.id ? 'Eliminando…' : 'Eliminar opinión'}
                      </button>
                    </div>
                    <p>{review.comment}</p>
                  </article>
                )) : !adminReviewMediaLoading && !adminProductReviewsLoading && !adminProductReviewsHasMore && (
                  <div className="admin-empty"><Icon name="sparkles" size={28} /><h3>No hay opiniones publicadas</h3><p>Las opiniones verificadas de clientes aparecerán acá para su administración.</p></div>
                )}
                {adminProductReviewsHasMore && adminProductReviewsNextCursor && (
                  <button
                    type="button"
                    className="auth-switch admin-review-media-next"
                    onClick={() => {
                      setAdminProductReviewsLoading(true)
                      setAdminProductReviewsCursor(adminProductReviewsNextCursor)
                    }}
                    disabled={adminProductReviewsLoading}
                  >
                    {adminProductReviewsLoading ? 'Cargando opiniones…' : 'Ver siguientes opiniones'}
                  </button>
                )}
                <div className="admin-section-heading admin-review-pending-heading">
                  <div><h3>Archivos pendientes de revisión</h3><p>Solo se publican después de aprobarlos. Revisá que no expongan datos personales.</p></div>
                </div>
                {pendingReviewMedia.length ? pendingReviewMedia.map((media) => (
                  <article className="admin-review-media-card" key={media.id}>
                    <div className="admin-review-media-preview">
                      {media.type === 'video'
                        ? <video src={media.url} controls preload="metadata" aria-label={`Video adjunto a una opinión de ${media.productName}`} />
                        : <a href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt={`Foto adjunta a una opinión de ${media.productName}`} /></a>}
                    </div>
                    <div className="admin-review-media-details">
                      <span>{media.productName} · {media.type === 'video' ? 'Video MP4' : 'Imagen'} · {(media.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                      <span>{media.createdAt ? new Date(media.createdAt).toLocaleString('es-AR') : 'Enviado recientemente'} · {media.rating}/5 estrellas</span>
                      <p>{media.comment}</p>
                      <div className="admin-review-media-actions">
                        <button type="button" className="button button-dark" onClick={() => void handleReviewMediaModeration(media.id, 'approve')} disabled={Boolean(adminReviewMediaBusy)}>Aprobar y publicar</button>
                        <button type="button" className="admin-review-media-reject" onClick={() => void handleReviewMediaModeration(media.id, 'reject')} disabled={Boolean(adminReviewMediaBusy)}>Rechazar y eliminar</button>
                      </div>
                    </div>
                  </article>
                )) : !adminReviewMediaLoading && <div className="admin-empty"><Icon name="check" size={28} /><h3>No hay archivos pendientes</h3><p>Las fotos y videos enviados por compradores aparecerán acá para su revisión.</p></div>}
                {pendingReviewMediaHasMore && pendingReviewMediaNextCursor && (
                  <button
                    type="button"
                    className="auth-switch admin-review-media-next"
                    onClick={() => {
                      setAdminReviewMediaLoading(true)
                      setAdminReviewMediaCursor(pendingReviewMediaNextCursor)
                    }}
                    disabled={adminReviewMediaLoading}
                  >
                    Ver siguientes archivos
                  </button>
                )}
              </section>
            ) : adminTab === 'products' ? (
              <section className="admin-products">
                <div className="admin-section-heading"><div><h3>{adminEditingProductId ? 'Editar publicación' : 'Publicar un producto'}</h3><p>Subí fotos reales y distintas del producto a Cloudinary. Cada publicación necesita al menos 5 y admite hasta 8.</p></div></div>
                <form className="admin-product-form" onSubmit={(event) => void handleAdminProductSave(event)}>
                  <label>Nombre<input name="name" value={adminProductDraft.name} onChange={(event) => setAdminProductDraft((current) => ({ ...current, name: event.target.value }))} maxLength={100} required disabled={adminProductUploadBusy} /></label>
                  <label>Categoría<select name="category" value={adminProductDraft.category} onChange={(event) => setAdminProductDraft((current) => ({ ...current, category: event.target.value }))}>{categories.slice(1).map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                  <label>Precio (ARS)<input name="price" type="number" min="1" step="1" value={adminProductDraft.price} onChange={(event) => setAdminProductDraft((current) => ({ ...current, price: event.target.value }))} required /></label>
                  <label>Precio anterior (ARS, opcional)<input name="originalPrice" type="number" min="1" step="1" value={adminProductDraft.originalPrice} onChange={(event) => setAdminProductDraft((current) => ({ ...current, originalPrice: event.target.value }))} aria-describedby="admin-product-offer-help" /></label>
                  <p className="admin-product-offer-help admin-product-full" id="admin-product-offer-help">Si es mayor al precio actual, el producto mostrará el precio anterior tachado y la etiqueta «Oferta».</p>
                  <label>Stock<input name="stock" type="number" min="0" step="1" value={adminProductDraft.stock} onChange={(event) => setAdminProductDraft((current) => ({ ...current, stock: event.target.value }))} required /></label>
                  <label className="admin-product-full">Descripción amplia<textarea name="description" value={adminProductDraft.description} onChange={(event) => setAdminProductDraft((current) => ({ ...current, description: event.target.value }))} maxLength={5000} rows={5} required /></label>
                  <fieldset className="admin-product-gallery-editor admin-product-full">
                    <legend>Fotos del producto</legend>
                    <p>Elegí tomas auténticas desde distintos ángulos; no uses copias de la misma imagen.</p>
                    <label className="admin-product-upload-label">Agregar fotos desde tu dispositivo
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={(event) => void handleAdminProductImageUpload(event)}
                        disabled={adminProductUploadBusy || adminProductBusy || getAdminProductImages(adminProductDraft).length >= 8}
                        aria-describedby="admin-product-upload-help"
                      />
                    </label>
                    <small id="admin-product-upload-help">JPEG, PNG o WebP; hasta 8 MB por foto. Las cargas van a Cloudinary.</small>
                    <div className="admin-product-image-count" role="status">
                      {getAdminProductImages(adminProductDraft).length} de 5 fotos mínimas · máximo 8
                      {adminProductUploadBusy && <span> Cargando fotos…</span>}
                    </div>
                    {getAdminProductImages(adminProductDraft).length > 0 && (
                      <div className="admin-product-image-list">
                        {getAdminProductImages(adminProductDraft).map((imageUrl, index) => (
                          <article className="admin-product-image-card" key={`${imageUrl}-${index}`}>
                            <img src={imageUrl} alt={`${adminProductDraft.name || 'Producto'}, foto ${index + 1}`} />
                            <div className="admin-product-image-card-actions">
                              <span>{index === 0 ? 'Portada' : `Foto ${index + 1}`}</span>
                              {index > 0 && (
                                <button
                                  type="button"
                                  className="auth-switch"
                                  onClick={() => setAdminProductDraft((current) => ({
                                    ...current,
                                    image: imageUrl,
                                    galleryImages: getAdminProductImages(current).filter((url) => url !== imageUrl).join('\n'),
                                  }))}
                                  disabled={adminProductUploadBusy}
                                >Usar de portada</button>
                              )}
                              <button
                                type="button"
                                className="auth-switch"
                                aria-label={`Quitar foto ${index + 1}`}
                                onClick={() => setAdminProductDraft((current) => {
                                  const remaining = getAdminProductImages(current).filter((url) => url !== imageUrl)
                                  const image = current.image === imageUrl ? remaining[0] ?? '' : current.image
                                  return {
                                    ...current,
                                    image,
                                    galleryImages: remaining.filter((url) => url !== image).join('\n'),
                                  }
                                })}
                                disabled={adminProductUploadBusy}
                              >Quitar</button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    <label className="admin-product-full">URL de portada o URLs adicionales (opcional, una HTTPS por línea)
                      <textarea
                        value={[adminProductDraft.image, adminProductDraft.galleryImages].filter(Boolean).join('\n')}
                        onChange={(event) => {
                          const [image = '', ...images] = event.target.value.split(/\r?\n/)
                          setAdminProductDraft((current) => ({ ...current, image, galleryImages: images.join('\n') }))
                        }}
                        placeholder={'https://… (una URL por línea)'}
                        rows={3}
                        disabled={adminProductUploadBusy}
                      />
                    </label>
                  </fieldset>
                  <fieldset className="admin-product-attributes admin-product-full">
                    <legend>Características generales</legend>
                    <p>Agregá solo datos confirmados del producto.</p>
                    {adminProductDraft.characteristics.map((attribute, index) => (
                      <div className="admin-product-attribute-row" key={`characteristic-${index}`}>
                        <input aria-label={`Nombre de característica ${index + 1}`} value={attribute.label} maxLength={60} placeholder="Característica" onChange={(event) => setAdminProductDraft((current) => ({ ...current, characteristics: current.characteristics.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }))} />
                        <input aria-label={`Valor de característica ${index + 1}`} value={attribute.value} maxLength={300} placeholder="Valor" onChange={(event) => setAdminProductDraft((current) => ({ ...current, characteristics: current.characteristics.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} />
                        <button type="button" className="auth-switch" aria-label={`Quitar característica ${index + 1}`} onClick={() => setAdminProductDraft((current) => ({ ...current, characteristics: current.characteristics.filter((_, itemIndex) => itemIndex !== index) }))}>Quitar</button>
                      </div>
                    ))}
                    <button type="button" className="auth-switch admin-attribute-add" disabled={adminProductDraft.characteristics.length >= 30} onClick={() => setAdminProductDraft((current) => ({ ...current, characteristics: [...current.characteristics, { label: '', value: '' }] }))}>+ Agregar característica</button>
                  </fieldset>
                  <fieldset className="admin-product-attributes admin-product-full">
                    <legend>Especificaciones</legend>
                    <p>Usá campos distintos para cada producto según corresponda.</p>
                    {adminProductDraft.specifications.map((attribute, index) => (
                      <div className="admin-product-attribute-row" key={`specification-${index}`}>
                        <input aria-label={`Nombre de especificación ${index + 1}`} value={attribute.label} maxLength={60} placeholder="Especificación" onChange={(event) => setAdminProductDraft((current) => ({ ...current, specifications: current.specifications.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }))} />
                        <input aria-label={`Valor de especificación ${index + 1}`} value={attribute.value} maxLength={300} placeholder="Valor" onChange={(event) => setAdminProductDraft((current) => ({ ...current, specifications: current.specifications.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} />
                        <button type="button" className="auth-switch" aria-label={`Quitar especificación ${index + 1}`} onClick={() => setAdminProductDraft((current) => ({ ...current, specifications: current.specifications.filter((_, itemIndex) => itemIndex !== index) }))}>Quitar</button>
                      </div>
                    ))}
                    <button type="button" className="auth-switch admin-attribute-add" disabled={adminProductDraft.specifications.length >= 30} onClick={() => setAdminProductDraft((current) => ({ ...current, specifications: [...current.specifications, { label: '', value: '' }] }))}>+ Agregar especificación</button>
                  </fieldset>
                  <div className="admin-product-actions admin-product-full">
                    {adminEditingProductId && <button type="button" className="auth-switch" disabled={adminProductUploadBusy || adminProductBusy} onClick={() => { setAdminEditingProductId(null); setAdminProductDraft(emptyAdminProductDraft) }}>Cancelar edición</button>}
                    <button className="button button-dark profile-save-button" type="submit" disabled={adminProductBusy || adminProductUploadBusy}>{adminProductBusy ? <><span className="button-spinner" aria-hidden="true" /> Guardando…</> : adminProductUploadBusy ? <><span className="button-spinner" aria-hidden="true" /> Cargando fotos…</> : adminEditingProductId ? 'Guardar cambios' : 'Publicar producto'}</button>
                  </div>
                </form>
                <div className="admin-product-list">
                  <div className="admin-product-list-heading">
                    <div><h3>Catálogo y stock</h3><p>Favoritos guardados en cuentas de clientes; no incluye listas locales de visitantes.</p></div>
                    <button
                      className="admin-wishlist-refresh"
                      type="button"
                      onClick={() => setAdminWishlistRefresh((current) => current + 1)}
                      disabled={adminWishlistLoading}
                    >
                      {adminWishlistLoading ? 'Actualizando…' : 'Actualizar favoritos'}
                    </button>
                  </div>
                  {adminWishlistError && (
                    <p className="admin-wishlist-error" role="alert">
                      {adminWishlistError}
                      <button type="button" onClick={() => setAdminWishlistRefresh((current) => current + 1)}>Reintentar</button>
                    </p>
                  )}
                  {catalog.map((product) => (
                    <article className="admin-product-row" key={product.id}>
                      <img src={product.image} alt="" />
                      <div className="admin-product-row-info">
                        <strong>{product.name}</strong>
                        <span>{money.format(product.price)} · {product.stock ?? 50} en stock · {product.active === false ? 'Oculto' : 'Publicado'}</span>
                        <span className="admin-product-wishlist">
                          <Icon name="heart" size={14} />
                          {adminWishlistCounts[product.id] === undefined
                            ? adminWishlistLoading ? 'Cargando favoritos…' : adminWishlistError ? 'No disponible' : '—'
                            : `${adminWishlistCounts[product.id]} ${adminWishlistCounts[product.id] === 1 ? 'favorito' : 'favoritos'}`}
                        </span>
                      </div>
                      <button type="button" onClick={() => handleEditAdminProduct(product)}>Editar</button>
                      <button type="button" onClick={() => void handleToggleProductAvailability(product)}>{product.active === false ? 'Publicar' : 'Ocultar'}</button>
                    </article>
                  ))}
                </div>
              </section>
            ) : adminTab === 'categories' ? (
              <section className="admin-categories">
                <div className="admin-section-heading">
                  <div><h3>Organizá el catálogo</h3><p>Las categorías nuevas aparecen en la tienda y en el formulario de productos.</p></div>
                </div>
                {adminCategoryError && <p className="profile-form-error admin-error" role="alert">{adminCategoryError}</p>}
                <form className="admin-category-form" onSubmit={(event) => void handleAdminCategoryCreate(event)}>
                  <label htmlFor="admin-category-name">Nombre de la categoría</label>
                  <div className="admin-category-controls">
                    <input
                      id="admin-category-name"
                      value={adminCategoryDraft}
                      onChange={(event) => setAdminCategoryDraft(event.target.value)}
                      maxLength={40}
                      placeholder="Ej.: Decoración"
                      required
                      disabled={adminCategoryBusy}
                    />
                    <button className="button button-dark" type="submit" disabled={adminCategoryBusy}>
                      {adminCategoryBusy ? 'Guardando…' : 'Crear categoría'}
                    </button>
                  </div>
                </form>
                <ul className="admin-category-list" aria-label="Categorías disponibles">
                  {categories.slice(1).map((category) => {
                    const productCount = catalog.filter((product) => product.category === category).length
                    const isCustom = customCategories.includes(category)
                    return (
                      <li key={category}>
                        <div><strong>{category}</strong><span>{productCount} {productCount === 1 ? 'producto' : 'productos'} · {isCustom ? 'Personalizada' : 'Predeterminada'}</span></div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : (
              <section className="admin-access">
                <div className="admin-section-heading">
                  <div><h3>Administradores</h3><p>Asigná el rol a una cuenta existente y con email verificado.</p></div>
                </div>
                <form className="admin-access-form" onSubmit={(event) => void handleGrantAdminAccess(event)}>
                  <label htmlFor="admin-user-email">Email de la cuenta</label>
                  <div className="admin-access-controls">
                    <input
                      id="admin-user-email"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      placeholder="nombre@correo.com"
                      value={adminUserEmail}
                      onChange={(event) => setAdminUserEmail(event.target.value)}
                      required
                    />
                    <button className="button button-dark" type="submit" disabled={adminUserBusy}>
                      {adminUserBusy ? <><span className="button-spinner" aria-hidden="true" /> Comprobando…</> : 'Dar acceso Admin'}
                    </button>
                  </div>
                  <p>La persona debe haberse registrado y verificar su dirección de email. No se crean cuentas desde este panel.</p>
                </form>
                <section className="admin-self-revoke" aria-labelledby="admin-self-revoke-title">
                  <div>
                    <h3 id="admin-self-revoke-title">Quitar mi acceso de administrador</h3>
                    <p>Tu cuenta dejará de tener permisos para administrar pedidos y productos. La página se actualizará al confirmar.</p>
                  </div>
                  <button
                    className="admin-self-revoke-button"
                    type="button"
                    onClick={() => void handleRevokeOwnAdminAccess()}
                    disabled={adminRevokeBusy}
                  >
                    {adminRevokeBusy ? 'Quitando acceso…' : 'Quitar mi acceso'}
                  </button>
                </section>
              </section>
            )}
              </main>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {cartOpen && (
        <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}>
          <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <div className="drawer-heading"><div><span className="eyebrow section-eyebrow">TU SELECCIÓN</span><h2 id="cart-title">Tu bolso <span>({cartCount})</span></h2></div><button className="icon-button" onClick={() => setCartOpen(false)} aria-label="Cerrar bolso"><Icon name="close" /></button></div>
            {cartItems.length ? (
              <>
                <div className="cart-list">{cartItems.map(({ product, quantity }) => (
                  <article className="cart-item" key={product.id}>
                    <img src={product.image} alt="" />
                    <div className="cart-item-details"><span>{product.category}</span><h3>{product.name}</h3><strong>{money.format(product.price)}</strong><div className="quantity-control"><button aria-label={`Quitar una unidad de ${product.name}`} onClick={() => changeQuantity(product.id, -1)} disabled={storeLoading}><Icon name="minus" size={15} /></button><span>{quantity}</span><button aria-label={`Agregar una unidad de ${product.name}`} onClick={() => changeQuantity(product.id, 1)} disabled={storeLoading || quantity >= Math.min(product.stock ?? 50, MAX_ORDER_QUANTITY)}><Icon name="plus" size={15} /></button></div></div>
                  </article>
                ))}</div>
                <div className="cart-summary">
                  <div><span>Subtotal</span><strong>{money.format(cartTotal)}</strong></div>
                  <div><span>Envío estimado</span><strong>{estimatedShipping ? money.format(estimatedShipping) : 'Gratis'}</strong></div>
                  <small>El pago seguro se realiza en Mercado Pago.</small>
                  <button className="button button-dark checkout-button" onClick={startCheckout}>
                    Continuar con mi compra <Icon name="arrow" size={17} />
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-cart"><span><Icon name="bag" size={30} /></span><h3>Tu bolso está esperando</h3><p>Hay muchos detalles lindos para descubrir.</p><button className="button button-dark" onClick={() => { setCartOpen(false); document.getElementById('productos')?.scrollIntoView({ behavior: 'smooth' }) }}>Explorar productos <Icon name="arrow" size={17} /></button></div>
            )}
          </aside>
        </div>
      )}

      {shoppingGuideOpen && (
        <div className="shopping-guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShoppingGuideOpen(false) }}>
          <section
            className="shopping-guide-dialog"
            ref={shoppingGuideDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shopping-guide-title"
            aria-describedby="shopping-guide-description"
            tabIndex={-1}
          >
            <button className="icon-button shopping-guide-close" type="button" ref={shoppingGuideCloseRef} onClick={() => setShoppingGuideOpen(false)} aria-label="Cerrar guía de compra">
              <Icon name="close" />
            </button>
            <span className="shopping-guide-mark" aria-hidden="true"><Icon name="sparkles" size={21} /></span>
            <span className="eyebrow section-eyebrow">TU PRIMERA COMPRA</span>
            <h2 id="shopping-guide-title">Comprar en Lúmina es simple</h2>
            <p className="shopping-guide-intro" id="shopping-guide-description">Te acompañamos desde que encontrás tu favorito hasta que podés seguir el estado de tu pedido.</p>
            <ol className="shopping-guide-steps">
              <li>
                <span className="shopping-guide-step-number">01</span>
                <div><h3>Explorá y elegí</h3><p>Buscá por categoría o usá los filtros. En cada producto podés ver fotos, precio, stock y opiniones.</p></div>
              </li>
              <li>
                <span className="shopping-guide-step-number">02</span>
                <div><h3>Armá tu bolso</h3><p>Agregá tus favoritos y ajustá las cantidades. Antes de seguir, revisá el subtotal y el envío estimado.</p></div>
              </li>
              <li>
                <span className="shopping-guide-step-number">03</span>
                <div><h3>Pagá y seguí tu pedido</h3><p>Ingresá o creá tu cuenta, completá la entrega y pagá en Mercado Pago. Después podrás consultar el estado en “Mis compras”.</p></div>
              </li>
            </ol>
            <button className="button button-dark shopping-guide-cta" type="button" onClick={() => {
              setShoppingGuideOpen(false)
              window.requestAnimationFrame(() => document.getElementById('productos')?.scrollIntoView({ behavior: 'smooth' }))
            }}>
              Empezar a explorar <Icon name="arrow" size={17} />
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

function App() {
  const isAuthActionRoute = window.location.pathname === '/auth/action'
  if (isAuthActionRoute) {
    const params = new URLSearchParams(window.location.search)
    return (
      <AuthActionPage
        mode={params.get('mode')}
        actionCode={params.get('oobCode')}
        preview={params.get('preview') === 'true'}
      />
    )
  }

  return <Storefront />
}

export default App
