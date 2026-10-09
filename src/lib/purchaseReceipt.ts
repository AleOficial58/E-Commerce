import { jsPDF } from 'jspdf'
import type { CustomerOrderStatus } from './commerceApi'

export function createPurchaseReceiptPdf(
  order: CustomerOrderStatus,
  money: Intl.NumberFormat,
): jsPDF {
  if (order.paymentStatus !== 'approved' || order.status === 'cancelled' || order.status === 'cancellation_refund_pending') {
    throw new Error('El comprobante estará disponible cuando el pago esté confirmado.')
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const left = 18
  const right = pageWidth - left
  let y = 20

  const addText = (value: string, x: number, top: number, width: number, options?: { bold?: boolean; size?: number }) => {
    pdf.setFont('helvetica', options?.bold ? 'bold' : 'normal')
    pdf.setFontSize(options?.size ?? 10)
    const lines = pdf.splitTextToSize(value, width)
    pdf.text(lines, x, top)
    return lines.length * ((options?.size ?? 10) * 0.42)
  }

  const addPageIfNeeded = (height: number) => {
    if (y + height <= pageHeight - 20) return
    pdf.addPage()
    y = 20
  }

  pdf.setFillColor(247, 241, 235)
  pdf.roundedRect(left, y, right - left, 39, 5, 5, 'F')
  pdf.setTextColor(42, 38, 35)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)
  pdf.text('LUMINA', left + 8, y + 12)
  pdf.setFontSize(12)
  pdf.text('COMPROBANTE DE COMPRA', left + 8, y + 22)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(100, 91, 83)
  pdf.text('Documento informativo · No válido como factura fiscal', left + 8, y + 30)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(42, 38, 35)
  pdf.text(`Pedido ${order.id.slice(0, 12).toLocaleUpperCase('es-AR')}`, right - 8, y + 13, { align: 'right' })
  y += 49

  const date = order.createdAt ? new Date(order.createdAt) : null
  const dateLabel = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short' }).format(date)
    : 'Fecha no disponible'
  addText(`Fecha: ${dateLabel}`, left, y, right - left)
  y += 7
  addText('Estado del pago: Acreditado por Mercado Pago', left, y, right - left, { bold: true })
  y += 12

  pdf.setFillColor(247, 241, 235)
  pdf.roundedRect(left, y, right - left, 9, 2, 2, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(70, 61, 54)
  pdf.text('PRODUCTO', left + 3, y + 6)
  pdf.text('CANT.', right - 57, y + 6, { align: 'right' })
  pdf.text('PRECIO', right - 31, y + 6, { align: 'right' })
  pdf.text('TOTAL', right - 3, y + 6, { align: 'right' })
  y += 14

  for (const item of order.items) {
    const label = pdf.splitTextToSize(item.name, right - left - 72) as string[]
    const rowHeight = Math.max(8, label.length * 5)
    addPageIfNeeded(rowHeight + 3)
    pdf.setTextColor(45, 40, 36)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text(label, left + 3, y)
    pdf.text(String(item.quantity), right - 57, y, { align: 'right' })
    pdf.text(money.format(item.price), right - 31, y, { align: 'right' })
    pdf.text(money.format(item.lineTotal), right - 3, y, { align: 'right' })
    y += rowHeight
    pdf.setDrawColor(231, 224, 217)
    pdf.line(left, y, right, y)
    y += 4
  }

  addPageIfNeeded(43)
  const totalRows = [
    ['Subtotal', money.format(order.subtotal)],
    ['Envío', order.shippingCost === 0 ? 'Gratis' : money.format(order.shippingCost)],
  ]
  for (const [label, value] of totalRows) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(75, 67, 61)
    pdf.text(label, right - 63, y)
    pdf.text(value, right - 3, y, { align: 'right' })
    y += 7
  }
  pdf.setDrawColor(190, 174, 160)
  pdf.line(right - 68, y - 2, right, y - 2)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(42, 38, 35)
  pdf.text('Total pagado', right - 63, y + 5)
  pdf.text(money.format(order.total), right - 3, y + 5, { align: 'right' })
  y += 18

  addPageIfNeeded(40)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(42, 38, 35)
  pdf.text('ENTREGA', left, y)
  y += 7
  const address = order.shipping
  const addressLines = [
    address.name,
    address.address + (address.apartment ? `, ${address.apartment}` : ''),
    `${address.city}, ${address.province} ${address.postalCode}`,
    `Teléfono: ${address.phone}`,
  ].filter(Boolean)
  for (const line of addressLines) {
    y += addText(line, left, y, right - left)
  }
  y += 10
  addPageIfNeeded(12)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(110, 101, 94)
  pdf.text('Este comprobante resume los datos de la compra y no reemplaza una factura fiscal.', left, Math.min(y, pageHeight - 14))

  return pdf
}

export function createRefundReceiptPdf(
  order: CustomerOrderStatus,
  money: Intl.NumberFormat,
): jsPDF {
  if (order.paymentStatus !== 'refunded') {
    throw new Error('La constancia estará disponible cuando Mercado Pago confirme el reembolso.')
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const left = 18
  const right = pageWidth - left
  let y = 20

  const addText = (value: string, x: number, top: number, width: number, size = 10) => {
    pdf.setFontSize(size)
    const lines = pdf.splitTextToSize(value, width)
    pdf.text(lines, x, top)
    return lines.length * (size * 0.42)
  }
  const addPageIfNeeded = (height: number) => {
    if (y + height <= pageHeight - 20) return
    pdf.addPage()
    y = 20
  }
  const refundEvent = order.statusHistory
    .filter((event) => event.status === 'cancelled' && event.detail?.includes('Reembolso confirmado'))
    .at(-1)
  const refundDate = refundEvent ? new Date(refundEvent.at) : null
  const refundDateLabel = refundDate && Number.isFinite(refundDate.getTime())
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short' }).format(refundDate)
    : 'No disponible'

  pdf.setFillColor(247, 241, 235)
  pdf.roundedRect(left, y, right - left, 39, 5, 5, 'F')
  pdf.setTextColor(42, 38, 35)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)
  pdf.text('LUMINA', left + 8, y + 12)
  pdf.setFontSize(12)
  pdf.text('CONSTANCIA INFORMATIVA DE REEMBOLSO', left + 8, y + 22)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(100, 91, 83)
  pdf.text('Generada por Lúmina · No es una factura fiscal ni un comprobante oficial de Mercado Pago', left + 8, y + 30)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(42, 38, 35)
  pdf.text(`Pedido ${order.id.slice(0, 12).toLocaleUpperCase('es-AR')}`, right - 8, y + 13, { align: 'right' })
  y += 50

  const orderDate = order.createdAt ? new Date(order.createdAt) : null
  const orderDateLabel = orderDate && Number.isFinite(orderDate.getTime())
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'long' }).format(orderDate)
    : 'No disponible'
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(45, 40, 36)
  y += addText(`Estado: Reembolso confirmado por Mercado Pago`, left, y, right - left, 10) + 4
  y += addText(`Fecha de compra: ${orderDateLabel}`, left, y, right - left, 9) + 3
  y += addText(`Fecha de confirmación del reembolso: ${refundDateLabel}`, left, y, right - left, 9) + 10

  pdf.setFillColor(247, 241, 235)
  pdf.roundedRect(left, y, right - left, 9, 2, 2, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(70, 61, 54)
  pdf.text('PRODUCTO', left + 3, y + 6)
  pdf.text('CANT.', right - 57, y + 6, { align: 'right' })
  pdf.text('IMPORTE DE PRODUCTOS', right - 3, y + 6, { align: 'right' })
  y += 14

  for (const item of order.items) {
    const label = pdf.splitTextToSize(item.name, right - left - 75) as string[]
    const rowHeight = Math.max(8, label.length * 5)
    addPageIfNeeded(rowHeight + 3)
    pdf.setTextColor(45, 40, 36)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text(label, left + 3, y)
    pdf.text(String(item.quantity), right - 57, y, { align: 'right' })
    pdf.text(money.format(item.lineTotal), right - 3, y, { align: 'right' })
    y += rowHeight
    pdf.setDrawColor(231, 224, 217)
    pdf.line(left, y, right, y)
    y += 4
  }

  addPageIfNeeded(48)
  for (const [label, value] of [
    ['Productos', money.format(order.subtotal)],
    ['Envío', order.shippingCost === 0 ? 'Gratis' : money.format(order.shippingCost)],
  ]) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(75, 67, 61)
    pdf.text(label, right - 63, y)
    pdf.text(value, right - 3, y, { align: 'right' })
    y += 7
  }
  pdf.setDrawColor(190, 174, 160)
  pdf.line(right - 68, y, right, y)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(42, 38, 35)
  pdf.text('Total devuelto', right - 63, y + 8)
  pdf.text(money.format(order.total), right - 3, y + 8, { align: 'right' })
  y += 22
  addPageIfNeeded(16)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(110, 101, 94)
  addText(
    'Esta constancia resume la información del pedido según los registros de Lúmina. Para el comprobante oficial de la operación, consultá los movimientos de tu cuenta de Mercado Pago.',
    left,
    y,
    right - left,
    8,
  )

  return pdf
}
