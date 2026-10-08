const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
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

  // La tienda solo usa email/contraseña. `getAuth` agrega por defecto el resolver de
  // popup/redirect, que intenta cargar https://apis.google.com/js/api.js y la política
  // CSP (script-src 'self') lo bloquea. `initializeAuth` sin ese resolver evita la carga.
  let auth: ReturnType<typeof authSdk.getAuth>
  try {
    auth = authSdk.initializeAuth(app, {
      persistence: [
        authSdk.indexedDBLocalPersistence,
        authSdk.browserLocalPersistence,
        authSdk.browserSessionPersistence,
      ],
    })
  } catch {
    auth = authSdk.getAuth(app)
  }

  return {
    app,
    auth,
    db: firestoreSdk.getFirestore(app),
    authSdk,
    firestoreSdk,
  }
}
