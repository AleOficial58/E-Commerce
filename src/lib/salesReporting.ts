/**
 * Shared sales-report contract and aggregation logic.
 * The API supplies validated order snapshots; this module calculates metrics
 * without depending on Firestore or UI state so the same rules can be tested.
 */
export type SalesReportOrder = {
  paymentStatus: string
  total: number
  items: {
    id: string
    name: string
    price: number
    quantity: number
    lineTotal: number
  }[]
}

export type SalesReportSummary = {
  currency: 'ARS'
  orderCount: number
  approvedOrderCount: number
  pendingOrderCount: number
  refundedOrderCount: number
  otherOrderCount: number
  grossSales: number
  refunds: number
  netSales: number
  pendingAmount: number
  unitsSold: number
  topProducts: {
    id: string
    name: string
    quantity: number
    sales: number
  }[]
}

/**
 * Computes current payment-state totals for orders created in a requested
 * period. Refunded orders remain in gross sales and are subtracted once to
 * expose net sales; only currently approved orders contribute sold units.
 */
export function summarizeSalesOrders(orders: SalesReportOrder[]): SalesReportSummary {
  const summary: SalesReportSummary = {
    currency: 'ARS',
    orderCount: orders.length,
    approvedOrderCount: 0,
    pendingOrderCount: 0,
    refundedOrderCount: 0,
    otherOrderCount: 0,
    grossSales: 0,
    refunds: 0,
    netSales: 0,
    pendingAmount: 0,
    unitsSold: 0,
    topProducts: [],
  }
  const products = new Map<string, { id: string; name: string; quantity: number; sales: number }>()

  for (const order of orders) {
    if (!Number.isFinite(order.total) || order.total < 0) {
      throw new Error('El reporte contiene un pedido con un total no válido.')
    }

    if (order.paymentStatus === 'approved') {
      summary.approvedOrderCount += 1
      summary.grossSales += order.total
      for (const item of order.items) {
        if (
          !Number.isInteger(item.quantity) || item.quantity < 1 ||
          !Number.isFinite(item.lineTotal) || item.lineTotal < 0
        ) {
          throw new Error('El reporte contiene un artículo con cantidades o importes no válidos.')
        }
        summary.unitsSold += item.quantity
        const product = products.get(item.id) ?? {
          id: item.id,
          name: item.name,
          quantity: 0,
          sales: 0,
        }
        product.quantity += item.quantity
        product.sales += item.lineTotal
        products.set(item.id, product)
      }
    } else if (order.paymentStatus === 'pending') {
      summary.pendingOrderCount += 1
      summary.pendingAmount += order.total
    } else if (order.paymentStatus === 'refunded') {
      summary.refundedOrderCount += 1
      summary.grossSales += order.total
      summary.refunds += order.total
    } else {
      summary.otherOrderCount += 1
    }
  }

  summary.netSales = summary.grossSales - summary.refunds
  summary.topProducts = [...products.values()]
    .sort((left, right) =>
      right.quantity - left.quantity ||
      right.sales - left.sales ||
      left.name.localeCompare(right.name, 'es'),
    )
    .slice(0, 10)
  return summary
}
