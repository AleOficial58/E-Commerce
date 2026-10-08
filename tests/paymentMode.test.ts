import assert from 'node:assert/strict'
import test from 'node:test'
import { isTestAccountPayment, paymentMatchesMode } from '../server/paymentMode.ts'

const testBuyer = { email: 'test_user_1234567890@testuser.com' }
const realBuyer = { email: 'persona@gmail.com' }

test('sandbox acepta pagos de prueba clásicos (live_mode false)', () => {
  assert.equal(paymentMatchesMode('sandbox', { live_mode: false }), true)
})

test('sandbox acepta live_mode true solo si el comprador es un usuario de prueba', () => {
  assert.equal(paymentMatchesMode('sandbox', { live_mode: true, payer: testBuyer }), true)
  assert.equal(paymentMatchesMode('sandbox', { live_mode: true, payer: realBuyer }), false)
  assert.equal(paymentMatchesMode('sandbox', { live_mode: true }), false)
  assert.equal(paymentMatchesMode('sandbox', { live_mode: true, payer: { email: null } }), false)
})

test('sandbox rechaza pagos sin live_mode informado', () => {
  assert.equal(paymentMatchesMode('sandbox', {}), false)
})

test('production solo acepta pagos live_mode true', () => {
  assert.equal(paymentMatchesMode('production', { live_mode: true, payer: realBuyer }), true)
  assert.equal(paymentMatchesMode('production', { live_mode: false }), false)
})

test('no se confunde un dominio parecido con un usuario de prueba', () => {
  assert.equal(isTestAccountPayment({ payer: { email: 'test_user_1@testuser.com.evil.io' } }), false)
  assert.equal(isTestAccountPayment({ payer: { email: 'x@testuser.com' } }), false)
  assert.equal(isTestAccountPayment({ payer: testBuyer }), true)
})
