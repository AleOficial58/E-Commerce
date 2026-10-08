export type PaymentMode = 'sandbox' | 'production'

export type PaymentModeInfo = {
  live_mode?: boolean
  payer?: { email?: string | null } | null
}

// Checkout Pro ejecuta las compras de prueba (cuenta vendedora y compradora de prueba)
// en su entorno "productivo", así que informa `live_mode: true` aunque el dinero sea ficticio.
// Una cuenta de prueba solo puede operar con otras cuentas de prueba (email
// test_user_XXXX@testuser.com): un pago cuyo comprador es un usuario de prueba nunca mueve dinero real.
const TEST_BUYER_EMAIL = /^test_user_[^@\s]+@testuser\.com$/i

export function isTestAccountPayment(payment: PaymentModeInfo): boolean {
  const email = payment.payer?.email
  return typeof email === 'string' && TEST_BUYER_EMAIL.test(email.trim())
}

export function paymentMatchesMode(mode: PaymentMode, payment: PaymentModeInfo): boolean {
  if (mode === 'production') return payment.live_mode === true
  if (payment.live_mode === false) return true
  return payment.live_mode === true && isTestAccountPayment(payment)
}
