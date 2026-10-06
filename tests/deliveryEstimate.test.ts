import assert from 'node:assert/strict'
import test from 'node:test'
import { formatEstimatedDelivery } from '../src/lib/deliveryEstimate.ts'

const now = new Date('2026-10-06T15:00:00.000Z')

test('formats a single date as today or tomorrow in Argentina', () => {
  assert.equal(formatEstimatedDelivery('2026-10-06', '2026-10-06', now), 'Llega hoy')
  assert.equal(formatEstimatedDelivery('2026-10-07', '2026-10-07', now), 'Llega mañana')
})

test('does not render an identical start and end date as a range', () => {
  assert.equal(
    formatEstimatedDelivery('2026-10-12', '2026-10-12', now),
    'Llega el 12 de octubre',
  )
})

test('retains a readable range when the dates are different', () => {
  assert.equal(
    formatEstimatedDelivery('2026-10-07', '2026-10-09', now),
    'Llega entre el 7 de octubre y el 9 de octubre',
  )
})
