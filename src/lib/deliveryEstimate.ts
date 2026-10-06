/**
 * Formats date-only delivery estimates consistently on order lists and details.
 * Date comparison uses Argentina's calendar so an exact next-day estimate reads
 * naturally as "Llega mañana", independent of the visitor's browser timezone.
 */
export function formatEstimatedDelivery(
  start: string,
  end: string,
  now = new Date(),
): string {
  const dateFormatter = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  const formatDate = (value: string) =>
    dateFormatter.format(new Date(`${value}T12:00:00Z`))

  if (start === end) {
    const today = getArgentinaDateInputValue(now)
    const [year, month, day] = today.split('-').map(Number)
    const tomorrowDate = new Date(Date.UTC(year, month - 1, day + 1))
    const tomorrow = tomorrowDate.toISOString().slice(0, 10)
    if (start === today) return 'Llega hoy'
    if (start === tomorrow) return 'Llega mañana'
    return `Llega el ${formatDate(start)}`
  }
  return `Llega entre el ${formatDate(start)} y el ${formatDate(end)}`
}

export function getArgentinaDateInputValue(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('No se pudo determinar la fecha de Argentina.')
  return `${year}-${month}-${day}`
}

/**
 * Presents a completed delivery from its recorded event time, never the stale
 * estimate that was set while the order was still in transit.
 */
export function formatDeliveredAt(deliveredAt: string | null, now = new Date()): string {
  if (!deliveredAt) return 'Entrega confirmada'
  const deliveredDate = getArgentinaDateInputValue(new Date(deliveredAt))
  const today = getArgentinaDateInputValue(now)
  const [year, month, day] = today.split('-').map(Number)
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
  if (deliveredDate === today) return 'Entregado hoy'
  if (deliveredDate === yesterday) return 'Entregado ayer'

  const formattedDate = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${deliveredDate}T12:00:00Z`))
  return `Entregado el ${formattedDate}`
}
