/**
 * Server-side sales-report query.
 * Validates the requested Argentina-calendar range, reads complete Firestore
 * pages, and delegates deterministic financial aggregation to shared logic.
 */
import type { Firestore } from 'firebase-admin/firestore'
import { Timestamp } from 'firebase-admin/firestore'
import { summarizeSalesOrders, type SalesReportOrder, type SalesReportSummary } from '../src/lib/salesReporting.js'

const reportPageSize = 500
const maximumReportOrders = 20_000
const millisecondsPerDay = 86_400_000

export class SalesReportError extends Error {
  constructor(message: string, public readonly status: 400 | 413 | 500) {
    super(message)
    this.name = 'SalesReportError'
  }
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
}

function argentinaDateStart(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day, 3)
}

function validateOrder(data: FirebaseFirestore.DocumentData): SalesReportOrder {
  if (
    typeof data.paymentStatus !== 'string' ||
    typeof data.total !== 'number' || !Number.isFinite(data.total) ||
    !Array.isArray(data.items)
  ) {
    throw new SalesReportError(
      'Hay datos de pedidos incompletos y no se puede calcular el reporte con precisión.',
      500,
    )
  }

  const items = data.items.map((item: unknown) => {
    if (
      typeof item !== 'object' || item === null ||
      !('id' in item) || typeof item.id !== 'string' ||
      !('name' in item) || typeof item.name !== 'string' ||
      !('price' in item) || typeof item.price !== 'number' || !Number.isFinite(item.price) ||
      !('quantity' in item) || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) ||
      !('lineTotal' in item) || typeof item.lineTotal !== 'number' || !Number.isFinite(item.lineTotal)
    ) {
      throw new SalesReportError(
        'Hay artículos de pedidos incompletos y no se puede calcular el reporte con precisión.',
        500,
      )
    }
    return {
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    }
  })

  return {
    paymentStatus: data.paymentStatus,
    total: data.total,
    items,
  }
}

/**
 * Fetches all orders created in the inclusive requested date range and
 * aggregates their current payment state. No partial summary is returned:
 * ranges over the supported size or containing malformed orders fail openly.
 */
export async function getSalesReport(
  firestore: Firestore,
  from: unknown,
  to: unknown,
): Promise<SalesReportSummary> {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    throw new SalesReportError('Indicá un período de fechas válido para el reporte.', 400)
  }

  const startUtc = argentinaDateStart(from)
  const endExclusiveUtc = argentinaDateStart(to) + millisecondsPerDay
  const rangeDays = (endExclusiveUtc - startUtc) / millisecondsPerDay
  const argentinaToday = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
  if (rangeDays < 1 || rangeDays > 366 || to > argentinaToday) {
    throw new SalesReportError(
      'El período debe abarcar hasta 366 días y no puede terminar en el futuro.',
      400,
    )
  }

  const startAt = Timestamp.fromMillis(startUtc)
  const endAt = Timestamp.fromMillis(endExclusiveUtc)
  const baseQuery = firestore.collection('orders')
    .where('createdAt', '>=', startAt)
    .where('createdAt', '<', endAt)
    .orderBy('createdAt', 'asc')
    .select('createdAt', 'paymentStatus', 'total', 'items')
  const orders: SalesReportOrder[] = []
  let lastDocument: FirebaseFirestore.QueryDocumentSnapshot | undefined

  while (true) {
    const pageQuery = lastDocument
      ? baseQuery.startAfter(lastDocument).limit(reportPageSize)
      : baseQuery.limit(reportPageSize)
    const page = await pageQuery.get()
    if (page.empty) break
    for (const document of page.docs) {
      orders.push(validateOrder(document.data()))
      if (orders.length > maximumReportOrders) {
        throw new SalesReportError(
          'El período contiene más de 20.000 pedidos. Elegí un rango más acotado para generar el reporte.',
          413,
        )
      }
    }
    lastDocument = page.docs[page.docs.length - 1]
  }

  return summarizeSalesOrders(orders)
}
