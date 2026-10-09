import assert from 'node:assert/strict'
import test from 'node:test'
import type { CustomerOrderStatus } from '../src/lib/commerceApi.ts'
import { createRefundReceiptPdf } from '../src/lib/purchaseReceipt.ts'

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
const order: CustomerOrderStatus = {
  id: 'order-refunded-123',
  paymentStatus: 'refunded',
  status: 'cancelled',
  canCancel: false,
  subtotal: 12000,
  shippingCost: 0,
  total: 12000,
  createdAt: '2026-10-01T12:00:00.000Z',
  statusHistory: [{
    status: 'cancelled',
    at: '2026-10-03T15:30:00.000Z',
    detail: 'Reembolso confirmado por Mercado Pago.',
  }],
  paymentMethodId: 'visa',
  paymentTypeId: 'credit_card',
  paymentCardLastFourDigits: '1234',
  shipmentType: 'local',
  estimatedDeliveryStart: null,
  estimatedDeliveryEnd: null,
  shipmentStage: null,
  shipmentStageDetail: null,
  trackingCarrier: null,
  trackingCode: null,
  trackingUrl: null,
  shipping: {
    name: 'Cliente',
    phone: '11111111',
    address: 'Calle 1',
    apartment: '',
    city: 'Buenos Aires',
    province: 'Buenos Aires',
    postalCode: '1000',
  },
  items: [{
    id: 'product-1',
    name: 'Producto de prueba',
    image: '',
    price: 12000,
    quantity: 1,
    lineTotal: 12000,
  }],
}

test('creates an informational PDF receipt for a confirmed refund', () => {
  const pdf = createRefundReceiptPdf(order, money)

  assert.equal(pdf.internal.getNumberOfPages(), 1)
  assert.match(pdf.output('datauristring'), /^data:application\/pdf/)
})

test('does not create a refund receipt before Mercado Pago confirms it', () => {
  assert.throws(
    () => createRefundReceiptPdf({ ...order, paymentStatus: 'approved' }, money),
    /Mercado Pago confirme el reembolso/,
  )
})
