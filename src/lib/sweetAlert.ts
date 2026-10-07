import type { SweetAlertOptions } from 'sweetalert2'

export async function showConfirmation(options: SweetAlertOptions) {
  const [{ default: Swal }] = await Promise.all([
    import('sweetalert2'),
    import('sweetalert2/dist/sweetalert2.min.css'),
  ])
  return Swal.fire(options)
}
