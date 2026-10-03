# Lúmina

Primera base de una tienda de accesorios, bijouterie y complementos. El proyecto usa React + TypeScript + Vite y Firebase Authentication/Firestore como backend administrado.

## Requisitos

- Node.js 20.19+ o 22.12+
- Un proyecto de Firebase para habilitar registro e inicio de sesión

## Ejecutar localmente

```powershell
npm install
Copy-Item .env.example .env.local
Copy-Item .env.server.example .env.server
npm run dev:full
```

Completá `.env.local` con los valores de configuración de una aplicación web de Firebase. No subas ese archivo al repositorio.

La API de correo necesita además:

1. En `.env.server`, poné el mismo identificador de proyecto Firebase en `FIREBASE_PROJECT_ID`.
2. Creá `secrets/` y descargá allí una clave de cuenta de servicio desde **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**. Guardala como `lumina-service-account.json`, que está excluida de Git.
3. Configurá `GOOGLE_APPLICATION_CREDENTIALS=./secrets/lumina-service-account.json`.
4. Completá `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` con las credenciales SMTP de un proveedor de email.
5. Para desarrollo local, dejá `PUBLIC_APP_URL=http://localhost:5173` y abrí la tienda usando esa misma dirección. Para enviar enlaces a clientes, debe ser la URL HTTPS pública donde esté publicada la tienda, y ese dominio debe estar autorizado en Firebase Authentication.

**No compartas ni subas la clave privada JSON ni las credenciales SMTP.** La cuenta de servicio da acceso administrativo al proyecto; mantenela solo en `secrets/` local y configurala como secreto en el servidor al desplegar.

`npm run dev:full` inicia Vite y la API Express local; Vite reenvía `/api` al puerto `3001`. El endpoint `/api/health` permite ver si Firebase Admin y SMTP están configurados, sin exponer sus valores.

En Firebase Console:

1. Creá un proyecto y registrá una aplicación web.
2. En **Authentication → Sign-in method**, habilitá **Email/Password**.
3. En **Authentication → Settings → Authorized domains**, verificá que `localhost` esté permitido para desarrollo.
4. Creá una base de **Cloud Firestore**.
5. Publicá las reglas de [`firestore.rules`](./firestore.rules).

La configuración pública de Firebase que usa la aplicación no reemplaza las reglas de seguridad: aplicá siempre reglas en Firebase y restringí las claves desde la consola cuando corresponda. Las reglas incluidas dejan el catálogo legible, bloquean su escritura desde el cliente y limitan los perfiles a su propio usuario.

## Correos y páginas de acción de Lúmina

La aplicación incluye un handler visual de Lúmina en `/auth/action` para verificar emails y restablecer contraseñas. La API genera los enlaces con Firebase Admin y los manda desde el servidor por SMTP, así que **no depende de poder editar las plantillas de correo de Firebase**.

Para que el envío sea real, completá Firebase Admin, la URL pública y las credenciales SMTP en `.env.server`. En desarrollo, usá `PUBLIC_APP_URL=http://localhost:5173` y accedé a la tienda con `http://localhost:5173`; los enlaces solo abrirán en esa máquina. En producción, usá el dominio HTTPS publicado y autorizalo en Firebase Authentication.

Para revisar el diseño localmente sin enviar correos ni cambiar contraseñas, abrí `/auth/action?mode=resetPassword&preview=true`. La vista previa desactiva el envío del formulario.

## Qué está implementado

- Catálogo de ejemplo en `src/data/products.ts`, con búsqueda y filtros por categoría.
- Favoritos persistidos en el navegador y bolso de compra con cantidades.
- Registro e inicio de sesión con Firebase Authentication.
- Envío y reenvío de verificación de email, comprobación del estado y recuperación de contraseña.
- Correos transaccionales de verificación/restablecimiento con diseño Lúmina, enviados desde la API con Firebase Admin y SMTP.
- Perfil editable en `users/{userId}` en Firestore, con datos de contacto, domicilio y un indicador visual de completitud.
- Checkout de demostración: dirección de entrega, resultado aprobado/rechazado sin datos de tarjeta, control de stock y pedido registrado en Firestore.
- Panel de administración protegido para publicaciones, disponibilidad, stock y seguimiento de pedidos de prueba.
- Favoritos y bolso sincronizados en subcolecciones del usuario autenticado:
  - `users/{userId}/favorites/{productId}`
  - `users/{userId}/cart/{productId}`
- Para visitantes, favoritos y bolso se guardan en el navegador. Al iniciar sesión se combinan con los datos de la cuenta.
- Diseño adaptable a escritorio y móvil.

El catálogo inicial de demostración está en `src/data/products.ts`; las publicaciones creadas desde Admin se guardan en Firestore y se combinan con ese catálogo. Las imágenes son URLs públicas HTTPS. Los cambios de favoritos, bolso, perfil, pedidos y publicaciones requieren las reglas de Firestore publicadas desde `firestore.rules`.

La verificación se envía al registrarse; la app permite explorar y guardar mientras tanto y muestra el estado en **Mi cuenta**. Firebase Admin genera enlaces de acción de un solo uso y el servidor los envía en correos de marca mediante SMTP; las plantillas integradas de Firebase ya no se usan para estos dos flujos.

## Decisiones de arquitectura para esta etapa

Firestore funciona como backend administrado para autenticación y datos privados del usuario. Se agregó una API Express pequeña porque Firebase Admin y el envío SMTP requieren credenciales privadas que no deben incluirse en React. La API valida tokens de Firebase para reenviar verificaciones, limita intentos, y da respuestas genéricas en el restablecimiento para no revelar si un email está registrado.

Los pagos de este proyecto son **solo simulaciones**: no se piden ni guardan tarjetas y no se mueve dinero. La API verifica el stock y vuelve a calcular los importes usando el catálogo confiable antes de registrar una compra aprobada en `orders/{orderId}`. El panel consulta esos pedidos y permite actualizar su estado. Las publicaciones se guardan en `products/{productId}` y usan una URL HTTPS de imagen para evitar Storage.

### Habilitar el panel de administración

1. Iniciá sesión en la tienda con la cuenta que va a administrar el catálogo.
2. En Firebase Console, abrí **Authentication → Users** y copiá el UID de esa cuenta.
3. Abrí **Firestore Database → Data**, creá la colección `admins` si todavía no existe y agregá un documento cuyo ID sea exactamente ese UID.
4. En ese documento agregá el campo `active` de tipo booleano con valor `true`. No se puede crear ni cambiar este permiso desde la web: las reglas rechazan escrituras a `admins`.
5. Publicá las reglas nuevas de [`firestore.rules`](./firestore.rules). Reiniciá la sesión para que aparezca el botón **Admin**.

El permiso lo comprueba la API con Firebase Admin y también lo aplican las reglas de Firestore. Mantené la cuenta de servicio del servidor privada. Los demás usuarios pueden ver productos y crear pedidos de prueba propios, pero no administrar publicaciones ni leer pedidos ajenos.

Los productos nuevos se publican desde el panel con nombre, categoría, descripción, precio, stock y URL de imagen HTTPS. Los productos de ejemplo conservan su catálogo inicial y comienzan con un stock de demostración; al procesar compras, la API lo descuenta de forma atómica. Ocultar un producto lo saca de la tienda sin borrar su historial.

El panel revisa pedidos nuevos mientras está abierto y muestra el cliente, la entrega, los artículos, los totales y el estado. Al cerrar o recargar el panel, los pedidos siguen guardados en Firestore.

## Probar en Render (versión de desarrollo)

El archivo [`render.yaml`](./render.yaml) define un único servicio web gratuito para pruebas. Render instala las dependencias, compila React y arranca Express; Express sirve `dist/` y la API `/api` desde el mismo dominio. La tienda muestra un aviso de **versión de desarrollo** y los pagos siguen siendo simulados: no se cobran ni almacenan tarjetas.

1. Subí este proyecto a un repositorio privado de GitHub y conectalo desde Render con **New → Blueprint**.
2. Render va a pedir las variables Firebase marcadas como `sync: false`. Obtené las `VITE_FIREBASE_*` de la configuración de tu aplicación web en Firebase; `FIREBASE_PROJECT_ID` debe ser el ID del mismo proyecto. Estos valores `VITE_*` son configuración pública de cliente y quedan incluidos en el frontend; nunca pongas allí credenciales privadas.
3. En **Environment → Secret Files**, agregá `lumina-service-account.json` con la clave de cuenta de servicio del proyecto Firebase. El blueprint ya apunta `GOOGLE_APPLICATION_CREDENTIALS` a `/etc/secrets/lumina-service-account.json`. Protegé ese archivo y no lo agregues al repositorio.
4. Esperá a que termine el deploy y abrí la URL `onrender.com`. En Firebase Authentication, agregá ese dominio en **Authorized domains**. Firestore debe tener publicadas las reglas de [`firestore.rules`](./firestore.rules).
5. Comprobá `https://TU-SERVICIO.onrender.com/api/health`. La API informa si Firebase Admin y SMTP están configurados, sin revelar credenciales. Firebase Admin permite autenticación de servidor, administración y pedidos de demostración. SMTP es opcional para navegar/probar el resto; sin SMTP no se enviarán correos de verificación ni recuperación.

La URL pública se detecta desde Render automáticamente. Si más adelante configurás `PUBLIC_APP_URL`, debe ser el origen HTTPS exacto del servicio. El plan gratuito puede suspender el servicio cuando no se usa y tardar en iniciar al volver a abrirlo. No uses este deploy para ventas reales.

En desarrollo local se mantiene el proxy `/api` de Vite; `npm run dev:full` inicia Vite y Express en paralelo. No despliegues la clave de servicio ni credenciales SMTP en el frontend o en variables `VITE_*`.

## Comandos

```powershell
npm run dev
npm run dev:api
npm run dev:full
npm run lint
npm run build
npm run typecheck:api
```

## Próximos pasos

1. Reemplazar el checkout simulado por un proveedor real solo cuando la tienda esté lista para cobrar, usando webhooks y validación desde el servidor.
2. Agregar historial de pedidos para cada cliente y notificaciones de estado.
3. Mejorar el panel con filtros, métricas y carga de imágenes cuando exista una solución de almacenamiento aprobada.
4. Implementar recomendaciones iniciales por categoría y popularidad.
