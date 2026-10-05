import type { User } from 'firebase/auth'

export async function uploadAdminProductImage(
  user: User,
  productId: string,
  file: File,
): Promise<string> {
  if (
    !/^[a-z0-9-]{1,80}$/.test(productId) ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size < 1 ||
    file.size > 8 * 1024 * 1024
  ) {
    throw new Error('Usá imágenes JPEG, PNG o WebP de hasta 8 MB.')
  }

  const token = await user.getIdToken()
  const response = await fetch(
    `/api/admin/products/${encodeURIComponent(productId)}/images`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type,
      },
      body: file,
      signal: AbortSignal.timeout(60_000),
    },
  )
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error(response.ok
      ? 'El servidor devolvió una respuesta no válida.'
      : 'No pudimos conectar con el servidor para cargar la imagen.')
  }
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null && 'error' in result
      ? String(result.error)
      : 'No se pudo cargar la imagen del producto.'
    throw new Error(message)
  }
  if (
    typeof result !== 'object' ||
    result === null ||
    !('url' in result) ||
    typeof result.url !== 'string' ||
    !result.url.startsWith('https://')
  ) {
    throw new Error('El servidor no confirmó la carga de la imagen.')
  }
  return result.url
}
