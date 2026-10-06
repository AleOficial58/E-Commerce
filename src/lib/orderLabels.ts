/**
 * Converts persisted order and Mercado Pago states into customer-facing copy.
 * Storage/API values remain stable identifiers; UI labels never expose them.
 */
const orderStatusLabels: Record<string, string> = {
  pending_payment: 'Pago pendiente',
  payment_failed: 'Pago no completado',
  payment_expired: 'Pago vencido',
  payment_review: 'Pago en revisión',
  new: 'Nuevo pedido',
  preparing: 'En preparación',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancellation_refund_pending: 'Reembolso en proceso',
  cancelled: 'Compra cancelada',
}

const paymentStatusLabels: Record<string, string> = {
  approved: 'Pago acreditado',
  pending: 'Esperando confirmación de pago',
  in_process: 'Pago en proceso',
  in_mediation: 'Pago en revisión con Mercado Pago',
  rejected: 'Pago rechazado',
  cancelled: 'Pago cancelado',
  refunded: 'Pago reembolsado',
  charged_back: 'Pago desconocido por el titular',
  expired: 'Pago vencido',
}

export function getOrderStatusLabel(status: string): string {
  return orderStatusLabels[status] ?? 'Estado actualizado'
}

export function getPaymentStatusLabel(status: string): string {
  return paymentStatusLabels[status] ?? 'Estado de pago actualizado'
}
