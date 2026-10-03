import type { User } from 'firebase/auth'

export type ReviewSummary = {
  ratingAverage: number
  reviewCount: number
}

export type ProductReview = {
  rating: number
  comment: string
  createdAt: string | null
  editedAt: string | null
  verifiedPurchase: boolean
  mine: boolean
}

export type ProductReviewsResult = {
  reviews: ProductReview[]
  canReview: boolean
  ownReview: ProductReview | null
  summary: ReviewSummary
}

async function requestJson<T>(
  endpoint: string,
  options: { user?: User | null; method?: 'GET' | 'POST'; body?: unknown } = {},
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
  return requestJson(
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
