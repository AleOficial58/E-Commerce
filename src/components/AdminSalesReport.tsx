/**
 * Admin-facing date-range sales report.
 * It requests an authorized, server-aggregated snapshot and presents financial
 * totals separately from pending and refunded orders.
 */
import { useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { loadAdminSalesReport } from '../lib/commerceApi'
import type { SalesReportSummary } from '../lib/salesReporting'

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

function argentinaDateInputValue(date: Date): string {
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

function firstDayOfCurrentMonth(): string {
  return `${argentinaDateInputValue(new Date()).slice(0, 7)}-01`
}

function todayInputValue(): string {
  return argentinaDateInputValue(new Date())
}

export function AdminSalesReport({ user }: { user: User }) {
  const [from, setFrom] = useState(firstDayOfCurrentMonth)
  const [to, setTo] = useState(todayInputValue)
  const [report, setReport] = useState<SalesReportSummary | null>(null)
  const [reportPeriod, setReportPeriod] = useState<{ from: string; to: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await loadAdminSalesReport(user, from, to)
      setReport(result)
      setReportPeriod({ from, to })
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'No se pudo cargar el reporte de ventas.')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (value: string) => new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`))

  return (
    <section className="admin-sales-report" aria-labelledby="sales-report-title">
      <div className="admin-section-heading">
        <div>
          <h3 id="sales-report-title">Rendimiento de ventas</h3>
          <p>Importes en pesos argentinos según la fecha de creación y el estado de pago actual de cada pedido.</p>
        </div>
        {loading && <span className="sync-indicator" aria-label="Calculando reporte" />}
      </div>

      <form className="admin-sales-report-filters" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Desde
          <input type="date" value={from} max={to} required onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={to} min={from} max={todayInputValue()} required onChange={(event) => setTo(event.target.value)} />
        </label>
        <button className="button button-dark" type="submit" disabled={loading || !from || !to}>
          {loading ? 'Calculando…' : 'Consultar ventas'}
        </button>
      </form>
      <p className="admin-sales-report-note">Se permiten períodos de hasta 366 días. Las devoluciones se descuentan de las ventas brutas para mostrar el neto.</p>

      {error && <p className="admin-sales-report-error" role="alert">{error}</p>}
      {report && reportPeriod && (
        <>
          <p className="admin-sales-report-period" aria-live="polite">
            Período: {formatDate(reportPeriod.from)} — {formatDate(reportPeriod.to)}
          </p>
          <div className="admin-sales-report-metrics">
            <article><span>Ventas netas</span><strong>{money.format(report.netSales)}</strong><small>Brutas menos reembolsos</small></article>
            <article><span>Ventas brutas</span><strong>{money.format(report.grossSales)}</strong><small>{report.approvedOrderCount + report.refundedOrderCount} pagos acreditados</small></article>
            <article><span>Pedidos aprobados</span><strong>{report.approvedOrderCount}</strong><small>{report.unitsSold} unidades no reembolsadas</small></article>
            <article><span>Reembolsos</span><strong>{money.format(report.refunds)}</strong><small>{report.refundedOrderCount} pedidos reembolsados</small></article>
            <article><span>Pendientes de pago</span><strong>{report.pendingOrderCount}</strong><small>{money.format(report.pendingAmount)} potenciales, no incluidos en ventas</small></article>
            <article><span>Otros estados</span><strong>{report.otherOrderCount}</strong><small>Fallidos, cancelados o en revisión</small></article>
          </div>

          <section className="admin-sales-report-products" aria-labelledby="sales-report-products-title">
            <h4 id="sales-report-products-title">Productos más vendidos</h4>
            {report.topProducts.length ? (
              <ol>
                {report.topProducts.map((product) => (
                  <li key={product.id}>
                    <span>{product.name}</span>
                    <span>{product.quantity} unidades</span>
                    <strong>{money.format(product.sales)}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No hay productos vendidos en pedidos aprobados dentro de este período.</p>
            )}
          </section>
          <p className="admin-sales-report-footnote">
            {report.orderCount} pedidos creados en el período. Los datos reflejan el estado de pago actual; un reembolso se atribuye al período de creación de su pedido.
          </p>
        </>
      )}
    </section>
  )
}
