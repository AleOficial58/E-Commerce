import type { User } from 'firebase/auth'
import { getFirebaseStorageServices } from './firebase'

export type ReviewSummary = {
  ratingAverage: number
  reviewCount: number
}

export type ReviewMedia = {
  id: string
  path: string
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
  path: string
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
  ).then(async (result) => {
    let mediaError = ''
    const hydrate = async (review: ProductReview | null) => {
      if (!review) return null
      try {
        return { ...review, media: await resolveMediaUrls(review.media ?? []) }
      } catch (error) {
        mediaError = error instanceof Error
          ? error.message
          : 'No pudimos cargar los archivos adjuntos a las opiniones.'
        return { ...review, media: [] }
      }
    }
    const reviews = await Promise.all(result.reviews.map(async (review) => {
      const hydrated = await hydrate(review)
      return hydrated ?? { ...review, media: [] }
    }))
    const ownReview = await hydrate(result.ownReview)
    return {
      ...result,
      reviews,
      ownReview,
      ...(mediaError ? { mediaError } : {}),
    }
  })
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

type ReviewMediaPath = Pick<ReviewMedia, 'id' | 'path' | 'type' | 'status' | 'contentType' | 'fileSize'>

async function resolveMediaUrls<T extends ReviewMediaPath>(
  media: T[],
): Promise<(T & Pick<ReviewMedia, 'url'>)[]> {
  if (!media.length) return []
  const approvedMedia = media.filter((item) => item.status === 'approved')
  if (!approvedMedia.length) return media.map((item) => ({ ...item, url: '' }))
  const { storage, storageSdk } = await getFirebaseStorageServices()
  const urls = await Promise.all(approvedMedia.map(async (item) => [
    item.id,
    await storageSdk.getDownloadURL(storageSdk.ref(storage, item.path)),
  ] as const))
  const urlById = new Map(urls)
  return media.map((item) => ({ ...item, url: urlById.get(item.id) ?? '' }))
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

  const reservation = await requestJson<{ id: string; path: string }>(
    `/api/products/${encodeURIComponent(productId)}/reviews/media`,
    {
      user,
      method: 'POST',
      body: { contentType: file.type, fileSize: file.size, type: mediaType },
    },
  )
  try {
    const { storage, storageSdk } = await getFirebaseStorageServices()
    await storageSdk.uploadBytes(storageSdk.ref(storage, reservation.path), file, {
      contentType: file.type,
    })
    await requestJson<{ message: string }>(
      `/api/products/${encodeURIComponent(productId)}/reviews/media/${encodeURIComponent(reservation.id)}/complete`,
      { user, method: 'POST' },
    )
    return {
      id: reservation.id,
      path: reservation.path,
      type: mediaType,
      status: 'pending',
      contentType: file.type,
      fileSize: file.size,
      url: '',
    }
  } catch (error) {
    try {
      await requestJson(
        `/api/products/${encodeURIComponent(productId)}/reviews/media/${encodeURIComponent(reservation.id)}`,
        { user, method: 'DELETE' },
      )
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : 'No se pudo subir el archivo.'} Además, no pudimos limpiar la carga incompleta: ${cleanupError instanceof Error ? cleanupError.message : 'error desconocido.'}`,
      )
    }
    throw error
  }
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
