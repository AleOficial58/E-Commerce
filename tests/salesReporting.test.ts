import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeSalesOrders, type SalesReportOrder } from '../src/lib/salesReporting.ts'

const item = (id: string, name: string, quantity: number, lineTotal: number) => ({
  id,
  name,
  price: lineTotal / quantity,
  quantity,
  lineTotal,
})

test('separates approved, pending, refunded and other orders in net sales', () => {
  const orders: SalesReportOrder[] = [
    { paymentStatus: 'approved', total: 1000, items: [item('bag', 'Bolso', 2, 900)] },
    { paymentStatus: 'pending', total: 500, items: [item('ring', 'Anillo', 1, 500)] },
    { paymentStatus: 'refunded', total: 250, items: [item('ring', 'Anillo', 1, 250)] },
    { paymentStatus: 'cancelled', total: 400, items: [] },
  ]

  assert.deepEqual(summarizeSalesOrders(orders), {
    currency: 'ARS',
    orderCount: 4,
    approvedOrderCount: 1,
    pendingOrderCount: 1,
    refundedOrderCount: 1,
    otherOrderCount: 1,
    grossSales: 1250,
    refunds: 250,
    netSales: 1000,
    pendingAmount: 500,
    unitsSold: 2,
    topProducts: [{ id: 'bag', name: 'Bolso', quantity: 2, sales: 900 }],
  })
})

test('ranks products by sold quantity, then product sales', () => {
  const summary = summarizeSalesOrders([
    {
      paymentStatus: 'approved',
      total: 1000,
      items: [
        item('necklace', 'Collar', 1, 300),
        item('bag', 'Bolso', 2, 400),
        item('clip', 'Hebilla', 2, 300),
      ],
    },
  ])

  assert.deepEqual(summary.topProducts.map(({ id }) => id), ['bag', 'clip', 'necklace'])
})

test('fails explicitly when order amounts are invalid', () => {
  assert.throws(
    () => summarizeSalesOrders([{ paymentStatus: 'approved', total: Number.NaN, items: [] }]),
    /total no válido/,
  )
})
