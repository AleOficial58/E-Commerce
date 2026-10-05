const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
)

export async function getFirebaseServices() {
  const [appSdk, authSdk, firestoreSdk] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore/lite'),
  ])
  const app = appSdk.getApps().length
    ? appSdk.getApp()
    : appSdk.initializeApp(firebaseConfig)

  return {
    app,
    auth: authSdk.getAuth(app),
    db: firestoreSdk.getFirestore(app),
    authSdk,
    firestoreSdk,
  }
}

export async function getFirebaseStorageServices() {
  const bucket = firebaseConfig.storageBucket
  if (!bucket) {
    throw new Error('Configurá VITE_FIREBASE_STORAGE_BUCKET para habilitar las imágenes y videos de opiniones.')
  }
  const [{ app }, storageSdk] = await Promise.all([
    getFirebaseServices(),
    import('firebase/storage'),
  ])
  return {
    storage: storageSdk.getStorage(app, `gs://${bucket}`),
    storageSdk,
  }
}
