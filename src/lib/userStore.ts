import { getFirebaseServices } from './firebase'

export type UserStore = {
  favorites: string[]
  cart: Record<string, number>
}

const guestFavoritesKey = 'lumina:guest:favorites'
const guestCartKey = 'lumina:guest:cart'

function readJson(key: string): unknown {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : null
  } catch (error) {
    console.warn(`No se pudieron leer los datos locales de ${key}.`, error)
    return null
  }
}

function readGuestFavorites(): string[] {
  const stored = readJson(guestFavoritesKey) ?? readJson('lumina:favorites')
  return Array.isArray(stored) && stored.every((item) => typeof item === 'string')
    ? stored
    : []
}

function readGuestCart(): Record<string, number> {
  const stored = readJson(guestCartKey)
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}

  return Object.fromEntries(
    Object.entries(stored).filter(
      ([id, quantity]) =>
        id.length > 0 &&
        typeof quantity === 'number' &&
        Number.isInteger(quantity) &&
        quantity > 0,
    ),
  )
}

export function readGuestStore(): UserStore {
  return {
    favorites: readGuestFavorites(),
    cart: readGuestCart(),
  }
}

export function saveGuestStore(store: UserStore) {
  localStorage.setItem(guestFavoritesKey, JSON.stringify(store.favorites))
  localStorage.setItem(guestCartKey, JSON.stringify(store.cart))
}

function mergeStores(remote: UserStore, guest: UserStore): UserStore {
  const favorites = [...new Set([...remote.favorites, ...guest.favorites])]
  const cart = { ...remote.cart }

  for (const [productId, quantity] of Object.entries(guest.cart)) {
    cart[productId] = (cart[productId] ?? 0) + quantity
  }

  return { favorites, cart }
}

export async function loadAndMergeUserStore(uid: string): Promise<UserStore> {
  const { db, firestoreSdk } = await getFirebaseServices()
  const favoritesRef = firestoreSdk.collection(db, 'users', uid, 'favorites')
  const cartRef = firestoreSdk.collection(db, 'users', uid, 'cart')
  const [favoritesSnapshot, cartSnapshot] = await Promise.all([
    firestoreSdk.getDocs(favoritesRef),
    firestoreSdk.getDocs(cartRef),
  ])

  const remote: UserStore = {
    favorites: favoritesSnapshot.docs.map((favorite) => favorite.id),
    cart: Object.fromEntries(
      cartSnapshot.docs.flatMap((item) => {
        const quantity: unknown = item.data().quantity
        return typeof quantity === 'number' &&
          Number.isInteger(quantity) &&
          quantity > 0
          ? [[item.id, quantity]]
          : []
      }),
    ),
  }
  const merged = mergeStores(remote, readGuestStore())

  await saveUserStore(uid, merged)
  localStorage.removeItem(guestFavoritesKey)
  localStorage.removeItem(guestCartKey)
  localStorage.removeItem('lumina:favorites')

  return merged
}

export async function saveUserStore(uid: string, store: UserStore) {
  const { db, firestoreSdk } = await getFirebaseServices()
  const favoritesRef = firestoreSdk.collection(db, 'users', uid, 'favorites')
  const cartRef = firestoreSdk.collection(db, 'users', uid, 'cart')
  const [currentFavorites, currentCart] = await Promise.all([
    firestoreSdk.getDocs(favoritesRef),
    firestoreSdk.getDocs(cartRef),
  ])
  const favoriteIds = new Set(store.favorites)
  const cartIds = new Set(Object.keys(store.cart))
  const writes = [
    ...currentFavorites.docs
      .filter((favorite) => !favoriteIds.has(favorite.id))
      .map((favorite) => firestoreSdk.deleteDoc(favorite.ref)),
    ...currentCart.docs
      .filter((item) => !cartIds.has(item.id))
      .map((item) => firestoreSdk.deleteDoc(item.ref)),
    ...store.favorites.map((productId) =>
      firestoreSdk.setDoc(firestoreSdk.doc(favoritesRef, productId), {
        productId,
        updatedAt: firestoreSdk.serverTimestamp(),
      }),
    ),
    ...Object.entries(store.cart).map(([productId, quantity]) =>
      firestoreSdk.setDoc(firestoreSdk.doc(cartRef, productId), {
        productId,
        quantity,
        updatedAt: firestoreSdk.serverTimestamp(),
      }),
    ),
  ]

  await Promise.all(writes)
}
