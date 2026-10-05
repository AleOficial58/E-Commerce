import type { User } from 'firebase/auth'

export type ReviewSummary = {
  ratingAverage: number
  reviewCount: number
}

export type ReviewMedia = {
  id: string
  type: 'image' | 'video'
  status: 'pending' | 'approved'
  url: string
  contentType: string
  fileSize: number
}

export type ProductReview = {
  rating: number
  comment: string
  createdAt: string | null
  editedAt: string | null
  verifiedPurchase: boolean
  mine: boolean
  media: ReviewMedia[]
}

export type ProductReviewsResult = {
  reviews: ProductReview[]
  canReview: boolean
  ownReview: ProductReview | null
  summary: ReviewSummary
  mediaError?: string
}

export type PendingReviewMedia = {
  id: string
  reviewId: string
  productId: string
  productName: string
  comment: string
  rating: number
  type: 'image' | 'video'
  contentType: string
  fileSize: number
  url: string
  createdAt: string | null
}

export type PendingReviewMediaPage = {
  media: PendingReviewMedia[]
  nextCursor: string | null
  hasMore: boolean
}

export type AdminProductReview = {
  id: string
  productId: string
  productName: string
  rating: number
  comment: string
  createdAt: string | null
}

async function requestJson<T>(
  endpoint: string,
  options: { user?: User | null; method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const token = options.user ? await options.user.getIdToken() : null
  const response = await fetch(endpoint, {
    method: options.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    const message = typeof result === 'object' && result !== null && 'error' in result
      ? String(result.error)
      : 'No pudimos completar la solicitud.'
    throw new Error(message)
  }
  return result as T
}

export async function loadReviewSummaries(): Promise<Record<string, ReviewSummary>> {
  const result = await requestJson<{ summaries: Record<string, ReviewSummary> }>('/api/reviews/summary')
  if (typeof result.summaries !== 'object' || result.summaries === null) {
    throw new Error('El servidor devolvió puntuaciones de productos no válidas.')
  }
  return result.summaries
}

export function loadProductReviews(
  productId: string,
  user?: User | null,
): Promise<ProductReviewsResult> {
  return requestJson<ProductReviewsResult>(
    `/api/products/${encodeURIComponent(productId)}/reviews`,
    { user },
  )
}

export function saveProductReview(
  user: User,
  productId: string,
  rating: number,
  comment: string,
): Promise<{ message: string; summary: ReviewSummary }> {
  return requestJson(
    `/api/products/${encodeURIComponent(productId)}/reviews`,
    { user, method: 'POST', body: { rating, comment } },
  )
}

export async function uploadProductReviewMedia(
  user: User,
  productId: string,
  file: File,
): Promise<ReviewMedia> {
  const mediaType = file.type.startsWith('image/') ? 'image' : file.type === 'video/mp4' ? 'video' : null
  const maxSize = mediaType === 'image' ? 8 * 1024 * 1024 : 25 * 1024 * 1024
  if (
    (mediaType !== 'image' && mediaType !== 'video') ||
    (mediaType === 'image' && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) ||
    file.size < 1 ||
    file.size > maxSize
  ) {
    throw new Error('El archivo no cumple los formatos o límites permitidos.')
  }

  const token = await user.getIdToken()
  const response = await fetch(
    `/api/products/${encodeURIComponent(productId)}/reviews/media`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type,
      },
      body: file,
      signal: AbortSignal.timeout(60_000),
    },
  )
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error(response.ok
      ? 'El servidor devolvió una respuesta no válida.'
      : 'No pudimos conectar con el servidor para cargar el archivo.')
  }
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null && 'error' in result
      ? String(result.error)
      : 'No se pudo enviar el archivo a revisión.'
    throw new Error(message)
  }
  if (
    typeof result !== 'object' ||
    result === null ||
    !('media' in result) ||
    typeof result.media !== 'object' ||
    result.media === null
  ) {
    throw new Error('El servidor no confirmó la carga del archivo.')
  }
  return result.media as ReviewMedia
}

export async function loadPendingReviewMedia(
  user: User,
  cursor = '',
): Promise<PendingReviewMediaPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return requestJson<PendingReviewMediaPage>(
    `/api/admin/product-review-media${query}`,
    { user },
  )
}

export function moderatePendingReviewMedia(
  user: User,
  mediaId: string,
  action: 'approve' | 'reject',
): Promise<{ message: string }> {
  return requestJson(
    `/api/admin/product-review-media/${encodeURIComponent(mediaId)}`,
    { user, method: 'PATCH', body: { action } },
  )
}

export function loadAdminProductReviews(
  user: User,
): Promise<{ reviews: AdminProductReview[] }> {
  return requestJson('/api/admin/product-reviews', { user })
}

export function deleteAdminProductReview(
  user: User,
  reviewId: string,
): Promise<{ message: string; productId: string; summary: ReviewSummary }> {
  return requestJson(
    `/api/admin/product-reviews/${encodeURIComponent(reviewId)}`,
    { user, method: 'DELETE' },
  )
}
