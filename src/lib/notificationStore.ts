import { useCallback, useSyncExternalStore } from 'react'
import { playNotificationSound } from './interfaceSounds'

export type StoreNotification = {
  id: string
  kind: 'order' | 'message'
  title: string
  message: string
  createdAt: string
  read: boolean
  orderId: string
}

type NotificationState = {
  items: StoreNotification[]
  soundEnabled: boolean
}

const MAX_NOTIFICATIONS = 50
const STORAGE_PREFIX = 'lumina.notifications.v1.'
const stateCache = new Map<string, NotificationState>()
const subscribers = new Map<string, Set<() => void>>()

function isNotification(value: unknown): value is StoreNotification {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'kind' in value && (value.kind === 'order' || value.kind === 'message') &&
    'title' in value && typeof value.title === 'string' &&
    'message' in value && typeof value.message === 'string' &&
    'createdAt' in value && typeof value.createdAt === 'string' &&
    'read' in value && typeof value.read === 'boolean' &&
    'orderId' in value && typeof value.orderId === 'string'
}

function readState(key: string): NotificationState {
  try {
    return parseState(window.localStorage.getItem(key))
  } catch {
    return { items: [], soundEnabled: true }
  }
}

function parseState(raw: string | null): NotificationState {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (typeof value !== 'object' || value === null) return { items: [], soundEnabled: true }
    const items = 'items' in value && Array.isArray(value.items)
      ? value.items.filter(isNotification).slice(0, MAX_NOTIFICATIONS)
      : []
    return {
      items,
      soundEnabled: 'soundEnabled' in value && typeof value.soundEnabled === 'boolean'
        ? value.soundEnabled
        : true,
    }
  } catch {
    return { items: [], soundEnabled: true }
  }
}

function getState(key: string): NotificationState {
  if (!stateCache.has(key)) stateCache.set(key, readState(key))
  return stateCache.get(key) ?? { items: [], soundEnabled: true }
}

function publish(key: string) {
  subscribers.get(key)?.forEach((listener) => listener())
}

function subscribe(key: string, listener: () => void) {
  const listeners = subscribers.get(key) ?? new Set<() => void>()
  listeners.add(listener)
  subscribers.set(key, listeners)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return
    stateCache.set(key, parseState(event.newValue))
    publish(key)
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function updateState(key: string, update: (current: NotificationState) => NotificationState) {
  const current = getState(key)
  const next = update(current)
  if (next === current) return
  stateCache.set(key, next)
  try {
    window.localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // Keep the notification center usable when storage is unavailable or full.
  }
  publish(key)
}

export function useNotificationStore(userId: string | null) {
  const storageKey = `${STORAGE_PREFIX}${userId || 'guest'}`
  const state = useSyncExternalStore(
    useCallback((listener) => subscribe(storageKey, listener), [storageKey]),
    useCallback(() => getState(storageKey), [storageKey]),
    useCallback(() => getState(storageKey), [storageKey]),
  )

  const addNotification = useCallback((notification: Omit<StoreNotification, 'read'>) => {
    let wasAdded = false
    let shouldPlaySound = false
    updateState(storageKey, (current) => {
      if (current.items.some((item) => item.id === notification.id)) return current
      wasAdded = true
      shouldPlaySound = current.soundEnabled
      return {
        ...current,
        items: [{ ...notification, read: false }, ...current.items].slice(0, MAX_NOTIFICATIONS),
      }
    })
    if (wasAdded && shouldPlaySound) playNotificationSound()
  }, [storageKey])

  const markRead = useCallback((id: string) => {
    updateState(storageKey, (current) => {
      if (!current.items.some((item) => item.id === id && !item.read)) return current
      return {
        ...current,
        items: current.items.map((item) => item.id === id ? { ...item, read: true } : item),
      }
    })
  }, [storageKey])

  const markAllRead = useCallback(() => {
    updateState(storageKey, (current) => current.items.some((item) => !item.read)
      ? { ...current, items: current.items.map((item) => ({ ...item, read: true })) }
      : current)
  }, [storageKey])

  const clearNotifications = useCallback(() => {
    updateState(storageKey, (current) => current.items.length
      ? { ...current, items: [] }
      : current)
  }, [storageKey])

  const setSoundEnabled = useCallback((soundEnabled: boolean) => {
    updateState(storageKey, (current) => current.soundEnabled === soundEnabled
      ? current
      : { ...current, soundEnabled })
  }, [storageKey])

  return {
    notifications: state.items,
    loading: false,
    soundEnabled: state.soundEnabled,
    addNotification,
    markRead,
    markAllRead,
    clearNotifications,
    setSoundEnabled,
  }
}
