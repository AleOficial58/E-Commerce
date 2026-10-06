import assert from 'node:assert/strict'
import test from 'node:test'
import { getOrderStatusLabel, getPaymentStatusLabel } from '../src/lib/orderLabels.ts'

test('translates internal order statuses into readable Spanish labels', () => {
  assert.equal(getOrderStatusLabel('cancellation_refund_pending'), 'Reembolso en proceso')
  assert.equal(getOrderStatusLabel('pending_payment'), 'Pago pendiente')
  assert.equal(getOrderStatusLabel('payment_review'), 'Pago en revisión')
  assert.equal(getOrderStatusLabel('delivered'), 'Entregado')
  assert.equal(getOrderStatusLabel('unexpected_internal_state'), 'Estado actualizado')
})

test('never displays unknown payment status identifiers verbatim', () => {
  assert.equal(getPaymentStatusLabel('approved'), 'Pago acreditado')
  assert.equal(getPaymentStatusLabel('refunded'), 'Pago reembolsado')
  assert.equal(getPaymentStatusLabel('charged_back'), 'Pago desconocido por el titular')
  assert.equal(getPaymentStatusLabel('new_provider_status'), 'Estado de pago actualizado')
})
