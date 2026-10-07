# Lúmina

Primera base de una tienda de accesorios, bijouterie y complementos. El proyecto usa React + TypeScript + Vite y Firebase Authentication/Firestore como backend administrado.

## Sistema y arquitectura

Lúmina es una tienda de un único vendedor con catálogo, cuentas de clientes, inventario, checkout de Mercado Pago, seguimiento de pedidos y administración. El comprobante PDF descargable es **no fiscal**: no sustituye una factura ni se conecta a un sistema de facturación oficial.

La solución combina una aplicación React con una API Express pequeña. La API concentra acciones que requieren credenciales privadas o validaciones confiables (checkout, webhooks, cambios de pedidos, informes, correo, moderación y administración). Para datos de usuario no privilegiados, React usa Firebase Authentication y Firestore directamente, siempre limitado por las reglas desplegadas.

### Mapa del sistema

```text
Cliente o administrador
  ├─ React + TypeScript (Vite)
  │    ├─ Firebase Authentication ── inicio de sesión e identidad
  │    ├─ Firestore del navegador ── perfil, catálogo público, favoritos y bolso
  │    └─ API Express (/api) ─────── operaciones protegidas y validación de negocio
  │                                  ├─ Firebase Admin ── pedidos, permisos e inventario
  │                                  ├─ Mercado Pago ──── checkout, conciliación y reembolsos
  │                                  ├─ Cloudinary ────── imágenes y adjuntos moderados
  │                                  └─ SMTP/Brevo ────── verificación y recuperación
  └─ Render sirve la SPA y la API en el mismo origen
```

La aplicación obtiene un ID token de Firebase y lo envía como `Authorization: Bearer` en las solicitudes protegidas. Express verifica el token y vuelve a comprobar el rol Admin en Firestore; no confía en un rol enviado por el navegador. Las llamadas directas del navegador a Firestore quedan restringidas por [`firestore.rules`](./firestore.rules). Mercado Pago confirma pagos mediante webhook firmado y consulta servidor-a-servidor, no mediante el parámetro de retorno del navegador.

### Módulos y flujo de datos

| Módulo | Responsabilidad | Archivos principales | Dependencias y flujo |
| --- | --- | --- | --- |
| Tienda y catálogo | Navegación, búsqueda, fichas, categorías, bolso y favoritos. | [`src/App.tsx`](./src/App.tsx), [`src/data/products.ts`](./src/data/products.ts), [`src/lib/userStore.ts`](./src/lib/userStore.ts) | React consume el catálogo público de Firestore y los productos de demostración; perfiles, bolso y favoritos se persisten en Firestore o localmente para visitantes. |
| Identidad y permisos | Sesión, recuperación/verificación de email y rol Admin. | [`src/lib/firebase.ts`](./src/lib/firebase.ts), [`src/lib/emailApi.ts`](./src/lib/emailApi.ts), [`server/index.ts`](./server/index.ts), [`server/email.ts`](./server/email.ts) | Firebase Authentication entrega identidad; Express verifica el ID token y resuelve `admins/{uid}` antes de acciones administrativas. |
| Checkout, pagos e inventario | Validación de precios/stock, reserva temporal, orden, confirmación y reembolso. | [`src/lib/commerceApi.ts`](./src/lib/commerceApi.ts), [`server/index.ts`](./server/index.ts), [`firestore.rules`](./firestore.rules) | React envía cantidades y dirección; Express consulta catálogo y Firestore, reserva stock transaccionalmente y crea preferencia en Mercado Pago. El webhook firmado y la conciliación confirman el pago y actualizan el pedido. |
| Compras y seguimiento | Historial propio, detalle, mensajes y estados de entrega. | [`src/components/CustomerOrdersPage.tsx`](./src/components/CustomerOrdersPage.tsx), [`src/components/OrderStatusPage.tsx`](./src/components/OrderStatusPage.tsx), [`src/components/OrderMessages.tsx`](./src/components/OrderMessages.tsx) | El cliente consulta solo sus pedidos a través de la API; Administración guarda estados y estimaciones y ambos lados intercambian mensajes ligados al pedido. |
| Administración de catálogo y opiniones | Publicación, stock, fotos, moderación y gestión de accesos. | [`src/App.tsx`](./src/App.tsx), [`src/lib/adminProductApi.ts`](./src/lib/adminProductApi.ts), [`src/lib/reviewsApi.ts`](./src/lib/reviewsApi.ts), [`server/index.ts`](./server/index.ts) | La API protege cargas, moderación y permisos; Firestore almacena las publicaciones y opiniones, Cloudinary guarda sus assets privados. |
| Reportes de ventas | Resumen histórico por fechas, estados de pago y productos. | [`src/components/AdminSalesReport.tsx`](./src/components/AdminSalesReport.tsx), [`src/lib/salesReporting.ts`](./src/lib/salesReporting.ts), [`server/salesReporting.ts`](./server/salesReporting.ts), [`tests/salesReporting.test.ts`](./tests/salesReporting.test.ts) | Admin solicita `GET /api/admin/sales-report`; Express consulta pedidos paginados en Firestore y la lógica compartida calcula ventas, devoluciones, pendientes y productos. |
| Comprobante | Descarga de resumen de compra en PDF no fiscal. | [`src/lib/purchaseReceipt.ts`](./src/lib/purchaseReceipt.ts) | Se genera en el cliente a partir del detalle del pedido; no emite comprobantes fiscales ni informa una factura fiscal. |

### Flujos funcionales

**Venta:** el cliente arma el bolso y completa dirección → la API vuelve a consultar precios y stock confiables → una transacción reserva inventario por 30 minutos y crea un pedido `pending` → la API crea la preferencia de Checkout Pro → Mercado Pago notifica el resultado firmado → el servidor vuelve a consultar Mercado Pago, valida pedido, importe, moneda y modo → acredita o registra el resultado y actualiza stock/estado → el cliente consulta el detalle y el seguimiento. Si la reserva vence o el pago falla, el stock retenido se libera. Un reembolso completo se refleja en el estado del pedido; el cliente no puede despachar un pedido en devolución pendiente.

Al regresar de Mercado Pago, la página presenta primero la confirmación celebratoria, el resumen del importe y el comprobante no fiscal; omite la línea de progreso, dirección y chat para no mezclar la confirmación con el seguimiento. El botón **Seguir mi pedido** abre directamente el detalle completo, que mantiene el seguimiento, la estimación, la información de entrega y el chat.

**Usuarios y autenticación:** Firebase Authentication administra registro, sesión, verificación y recuperación. Los perfiles se guardan en `users/{uid}`; cada persona lee y actualiza solo su propio perfil. Las acciones privadas reciben un ID token y la API verifica el UID. El rol se almacena en `admins/{uid}` y se comprueba en el servidor y en las reglas; `ADMIN_EMAILS` sirve para bootstrap, no reemplaza la verificación del rol.

**Productos, clientes e inventario:** el catálogo inicial de demostración está en código y las publicaciones del Admin se guardan en `products/{productId}`. El Admin gestiona precio, stock, visibilidad, galería y atributos. Los clientes guardan bolso/favoritos bajo sus documentos de usuario (o localmente mientras son visitantes). El stock se reserva/descuenta desde el servidor y no debe modificarse desde el navegador. Los pedidos conservan una instantánea de los artículos comprados y la dirección para no depender de cambios posteriores del catálogo.

**Reportes:** el filtro incluye ambas fechas seleccionadas (calendario de Argentina), permite hasta 366 días y consulta todas las páginas del rango, no los 50 pedidos del panel operativo. Ventas brutas suman pedidos aprobados y reembolsados; el reembolso completo se resta para calcular ventas netas. Pendientes se muestran aparte y no se suman como ingresos. Los productos y las unidades se cuentan en pedidos actualmente aprobados. Un pedido reembolsado se atribuye al período de creación original; por ello este informe describe el estado actual de los pedidos del período, no un libro contable por fecha de liquidación.

Las fechas estimadas exactas se presentan con expresiones claras según el calendario argentino: “Llega hoy”, “Llega mañana” o la fecha del mes. Solo se usa “Llega entre…” cuando el cliente tiene un rango de días distintos. Esta presentación se comparte entre el detalle y la lista de compras. Al marcar un pedido como entregado, ambas vistas reemplazan la estimación por la fecha real registrada: “Entregado hoy”, “Entregado ayer” o la fecha confirmada; nunca muestran una fecha futura estimada como si el pedido siguiera pendiente. El panel y las notificaciones traducen los estados internos de pedidos y pagos a etiquetas legibles; los identificadores de la API/Firestore no se exponen como texto de interfaz.

El detalle de seguimiento elige la secuencia de etapas por el tipo de envío y, si ese dato no existe en pedidos anteriores, por la etapa real registrada. Así, un pedido en tránsito no queda sin una etapa activa ni muestra una secuencia genérica que contradiga el título.

La celebración especial de entrega se reserva para el momento en que se detecta el cambio a entregado; al volver a consultar, se muestra el seguimiento estable. Para pedidos entregados, la ayuda ofrece consultas de devolución/reembolso, problemas con el producto u otras dudas de entrega, y aclara que el contacto no confirma ni procesa automáticamente un reintegro. Las acciones propias de pedidos aún en camino no se muestran en ese estado. La cancelación previa al despacho pide confirmación mediante SweetAlert antes de solicitar la cancelación y, si corresponde, el reembolso a Mercado Pago.

En Administración, la configuración de envío solo está disponible para pedidos con pago aprobado que todavía no se hayan entregado; los mensajes del pedido permanecen disponibles para consultas posteriores. En escritorio, las secciones de navegación se muestran sin una barra de desplazamiento horizontal, mientras que en pantallas angostas mantienen desplazamiento lateral. El alto contraste conserva texto legible y usa límites más discretos para evitar que cada bloque interno parezca una tarjeta independiente.

### Datos principales y relaciones

| Colección/documento | Contenido y relación |
| --- | --- |
| `users/{uid}` | Perfil y datos de contacto/domicilio del usuario autenticado. |
| `users/{uid}/favorites/{productId}` / `cart/{productId}` | Favoritos y bolso privados por cuenta; los visitantes usan almacenamiento local. |
| `admins/{uid}` | `active` define el permiso administrativo; el servidor es el único escritor confiable. |
| `products/{productId}` | Publicación, imágenes HTTPS, atributos, precio, disponibilidad y stock. |
| `categories/{categoryId}` | Categorías dinámicas administrables, referenciadas por productos. |
| `orders/{orderId}` | Usuario, artículos y dirección como instantánea, importes ARS, pago, envío, historial, reserva y marcas temporales. Cada pedido pertenece a un `userId`. |
| `productReviews/{reviewId}` / `productReviewSummaries/{productId}` | Opiniones verificadas y promedios por producto; `verifiedPurchases` valida compras anteriores. |
| `orders/{orderId}/messages/{messageId}` | Mensajes del cliente y Administración asociados a una compra. |

Firestore también contiene documentos auxiliares de revisión/moderación de archivos. Las escrituras privilegiadas se realizan con Firebase Admin después de validaciones de API; no son accesibles con las credenciales del navegador.

### Roles, comprobantes y límites del producto

| Actor | Puede hacer |
| --- | --- |
| Visitante | Explorar el catálogo, administrar bolso/favoritos locales e iniciar autenticación. |
| Cliente autenticado | Gestionar sus datos y compras, pagar, consultar seguimiento, comunicarse sobre su pedido y opinar sobre compras verificadas. |
| Administrador activo | Gestionar catálogo/categorías, pedidos/envíos, opiniones/archivos, accesos y reportes históricos. La API valida su sesión y rol. |

Los PDFs disponibles son comprobantes informativos no fiscales. No existe todavía facturación electrónica, integración con ARCA, conciliación bancaria/contable, sistema multi-vendedor ni seguimiento de ubicación en vivo. Las métricas del reporte son operativas, no sustituyen registros contables.

### API de Express

Todas las rutas están implementadas en [`server/index.ts`](./server/index.ts); salvo salud y endpoints públicos descritos, se exige Firebase ID token. Las rutas `/api/admin/*` requieren además rol Admin activo.

| Rutas | Métodos y función |
| --- | --- |
| `/api/health` | `GET`: estado de configuración de integraciones sin devolver secretos. |
| `/api/admin/status`, `/api/admin/self-revoke`, `/api/admin/users` | `GET`/`POST`: consultar elegibilidad Admin, revocar el propio acceso y conceder accesos. |
| `/api/email/verification`, `/api/email/password-reset` | `POST`: enviar acciones de verificación y recuperación. |
| `/api/payments/mercadopago/preference`, `/api/payments/mercadopago/webhook` | `POST`: crear Checkout Pro y procesar notificaciones firmadas. |
| `/api/orders`, `/api/orders/:orderId`, `/api/orders/:orderId/payment-sync`, `/api/orders/:orderId/cancel` | `POST`/`GET`: crear pedido, leer compra propia, conciliar pago y solicitar cancelación/reembolso. |
| `/api/orders/:orderId/messages` | `GET`/`POST`: consultar y enviar mensajes del pedido propio o administrado. |
| `/api/reviews/summary`, `/api/products/:productId/reviews`, `/api/products/:productId/reviews/media` | `GET`/`POST`: resúmenes, lectura/escritura de opiniones y carga de adjuntos. |
| `/api/admin/product-reviews`, `/api/admin/product-reviews/:reviewId`, `/api/admin/product-review-media`, `/api/admin/product-review-media/:mediaId` | `GET`/`DELETE`/`PATCH`: listar y moderar opiniones y archivos. |
| `/api/admin/products/:productId/images`, `/api/admin/products/wishlist-counts` | `POST`: cargar imágenes de producto y consultar conteos agregados de favoritos. |
| `/api/admin/orders`, `/api/admin/orders/:orderId` | `GET`/`PATCH`: listar últimos 50 pedidos operativos y actualizar estado/envío. |
| `/api/admin/sales-report` | `GET`: informe de ventas completo de un rango; acepta `from=YYYY-MM-DD` y `to=YYYY-MM-DD`. |

Categorías y parte del perfil, bolso y favoritos se gestionan directamente desde Firestore con las reglas de seguridad, por eso no tienen una ruta Express dedicada. Los contratos de pedidos/pagos están en [`src/lib/commerceApi.ts`](./src/lib/commerceApi.ts).

### Configuración y variables de entorno

| Variables | Dónde | Uso |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Cliente (`.env.local`/Render) | Configuración pública de la app web Firebase; queda en el bundle. No son credenciales administrativas. |
| `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` | Servidor (`.env.server`/Render Secret Files) | Proyecto y credenciales de Firebase Admin; la clave JSON nunca va al cliente ni a Git. En hosting con identidad de servicio puede usarse Application Default Credentials. |
| `ADMIN_EMAILS` | Servidor | Lista separada por comas para inicializar administradores de confianza. |
| `PUBLIC_APP_URL`, `PORT`, `NODE_ENV` | Servidor/plataforma | Origen para enlaces y retornos, puerto y modo de ejecución. Render también aporta `RENDER_EXTERNAL_URL`. |
| `MERCADO_PAGO_MODE`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MERCADO_PAGO_ALLOW_PRODUCTION` | Servidor | Checkout y verificación. Se inicia en `sandbox`; producción requiere habilitación explícita adicional. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Servidor | Cargas privadas de imágenes/medios. Nunca usar prefijo `VITE_`. |
| `BREVO_API_KEY`, `EMAIL_FROM` | Servidor, opcional | Envío por Brevo, con prioridad sobre SMTP. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Servidor, opcional | Alternativa de envío de emails por SMTP. |

## Requisitos

- Node.js 20.19+ o 22.12+
- Un proyecto de Firebase para habilitar registro e inicio de sesión

## Ejecutar localmente

```powershell
npm install
npm run dev:full
```

Antes de iniciar la aplicación, creá `.env.local` y `.env.server` en la raíz del proyecto. Completá `.env.local` con los valores de configuración de una aplicación web de Firebase y `.env.server` con las variables backend indicadas más abajo. No subas esos archivos al repositorio.

Las reseñas verificadas admiten puntuación, comentario y fotos/videos moderados. Los adjuntos usan Cloudinary Free; no se usa Firebase Storage ni Dropbox. La aplicación admite hasta 4 imágenes JPEG/PNG/WebP (8 MiB cada una) y un video MP4 (25 MiB) por opinión. La opinión de texto se guarda independientemente: si Cloudinary no está configurado o agotó la cuota, se informa el error específico de los archivos sin ocultar que el texto sí se guardó.

### Fotos y videos de opiniones con Cloudinary Free

Cloudinary Free ofrece **25 créditos mensuales compartidos** entre almacenamiento, entrega y transformaciones. El almacenamiento consume 1 crédito por cada GB y la entrega consume 1 crédito por cada GB; las transformaciones también consumen créditos según su uso. No requiere tarjeta de crédito. Por ser una cuota mensual compartida, el espacio y el tráfico disponibles dependen del consumo combinado y no constituyen una capacidad de producción garantizada; consultá las condiciones vigentes en Cloudinary.

1. Creá una cuenta Cloudinary en el plan gratuito y copiá el **Cloud name**, **API Key** y **API Secret** de la consola.
2. Para desarrollo local, agregá estas variables a `.env.server`:

   ```dotenv
   CLOUDINARY_CLOUD_NAME=tu_cloud_name
   CLOUDINARY_API_KEY=tu_api_key
   CLOUDINARY_API_SECRET=tu_api_secret
   ```

3. En Render, cargá esas mismas tres variables en **Dashboard → Environment**. `render.yaml` las declara sin valores; Render permite configurarlas como secretos al crear o actualizar el servicio.
4. Reiniciá el servidor local (`npm run dev:full`) o desplegá el servicio. Si las variables faltan, pedidos, opiniones de texto y el resto de la tienda siguen funcionando, pero la carga y moderación de adjuntos se deshabilitan con un aviso específico.
5. Controlá **Usage** en la consola de Cloudinary regularmente para revisar créditos, almacenamiento y entrega. Al agotar los créditos, la API mantiene disponible el texto de la opinión, rechaza la carga de archivos con un mensaje explícito y permite volver a intentar cuando se renueve la cuota.

### Galería de fotos de productos

El panel Admin permite cargar fotos JPEG, PNG o WebP de hasta 8 MiB directamente a Cloudinary, con un máximo de 8 fotos por producto. Cada publicación nueva necesita al menos 5 fotos distintas; la portada se elige desde la galería. Las fotos se guardan como assets autenticados en la carpeta `products/` y el servidor devuelve sus URLs de entrega firmadas. El formulario conserva la edición de URLs HTTPS para productos existentes, pero no acepta guardar una publicación con menos de 5 fotos distintas. Las fotos reales de productos existentes deben cargarse desde el panel; la aplicación no genera ni duplica imágenes para completar el mínimo.

Las credenciales Cloudinary se usan únicamente en el servidor para las fotos y videos de reseñas y las imágenes de productos. **No las pongas en variables `VITE_*`, el navegador ni el repositorio.** Las cargas de reseñas quedan como assets autenticados y privados; el equipo las previsualiza mediante URLs firmadas y solo las aprobadas se incluyen en las opiniones públicas. Rechazar una carga elimina el asset de Cloudinary. Cloudinary no participa en Firebase Authentication/Firestore, checkout ni Mercado Pago. No se requiere Firebase Storage, vincular Firebase Blaze ni usar Dropbox.

La API de correo necesita además:

1. En `.env.server`, poné el mismo identificador de proyecto Firebase en `FIREBASE_PROJECT_ID`.
2. Creá `secrets/` y descargá allí una clave de cuenta de servicio desde **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**. Guardala como `lumina-service-account.json`, que está excluida de Git.
3. Configurá `GOOGLE_APPLICATION_CREDENTIALS=./secrets/lumina-service-account.json`.
4. Para desarrollo local, completá `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` con las credenciales SMTP de un proveedor de email. El servidor aplica tiempos máximos de conexión y respuesta para que un SMTP inaccesible no deje la solicitud cargando indefinidamente.
5. Para desarrollo local, dejá `PUBLIC_APP_URL=http://localhost:5173` y abrí la tienda usando esa misma dirección. Para enviar enlaces a clientes, debe ser la URL HTTPS pública donde esté publicada la tienda, y ese dominio debe estar autorizado en Firebase Authentication.

**No compartas ni subas la clave privada JSON ni las credenciales SMTP.** La cuenta de servicio da acceso administrativo al proyecto; mantenela solo en `secrets/` local y configurala como secreto en el servidor al desplegar.

Para habilitar el checkout sandbox en local, agregá en `.env.server` `MERCADO_PAGO_MODE=sandbox`, el Access Token que figura en **Pruebas → Credenciales de prueba** como `MERCADO_PAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET=...`. No uses el usuario ni la contraseña de prueba como Access Token. El secreto debe ser el de la notificación configurada para el evento `payment`. No configures estas variables como `VITE_*`; no habilites `MERCADO_PAGO_ALLOW_PRODUCTION` en esta etapa.

`npm run dev:full` inicia Vite y la API Express local; Vite reenvía `/api` al puerto `3001`. El endpoint `/api/health` informa si Firebase Admin, SMTP, Mercado Pago y Cloudinary están configurados, sin exponer sus valores.

En Firebase Console:

1. Creá un proyecto y registrá una aplicación web.
2. En **Authentication → Sign-in method**, habilitá **Email/Password**.
3. En **Authentication → Settings → Authorized domains**, verificá que `localhost` esté permitido para desarrollo.
4. Creá una base de **Cloud Firestore**.
5. Publicá las reglas e índices de Firestore con `firebase deploy --only firestore`; el proyecto usa [`firestore.rules`](./firestore.rules) y [`firestore.indexes.json`](./firestore.indexes.json). Para aplicar solamente las reglas que exigen 5 fotos al crear o modificar la galería de un producto, podés usar `firebase deploy --only firestore:rules --project TU_PROJECT_ID`.
La configuración pública de Firebase que usa la aplicación no reemplaza las reglas de seguridad: aplicá siempre reglas en Firebase y restringí las claves desde la consola cuando corresponda. Las reglas incluidas dejan el catálogo legible, bloquean su escritura desde el cliente y limitan los perfiles a su propio usuario.

Desde **Mi cuenta**, cada cliente autenticado puede abrir la sección independiente **Mis compras**, consultar sus últimos 50 pedidos y abrir el detalle con productos, fotos, fecha y hora, medio de pago disponible, rango estimado de entrega y progreso local o internacional. Administración configura por pedido el tipo de envío, las fechas, la etapa, una novedad visible y opcionalmente el transportista/código/enlace de seguimiento; la ubicación en vivo depende de la empresa de correo y no está integrada. Cliente y administración pueden intercambiar mensajes asincrónicos asociados al pedido. El cliente puede cancelar un pedido antes del despacho: si el pago sigue pendiente, se libera la reserva de stock; si Mercado Pago ya lo aprobó, la API solicita el reembolso completo con una clave de idempotencia estable y conserva el pedido bloqueado para despacho hasta confirmar el reembolso. Antes de solicitarlo, la API verifica que el modo guardado en el pedido coincida con el modo del servicio; un desajuste se rechaza sin llamar a Mercado Pago. Si Mercado Pago todavía lo procesa o no responde, se puede reintentar desde el detalle sin duplicar el reembolso; el detalle vuelve a consultar el pedido incluso ante un error para mostrar el estado real de la solicitud y ofrecer la acción correcta. Los logs guardan el estado HTTP y campos diagnósticos acotados de la respuesta del proveedor, nunca el token. El botón no aparece después del despacho y la API valida nuevamente esta condición para evitar carreras con administración. En modo productivo, un reembolso confirmado devuelve dinero real al comprador. Las demás opciones de ayuda abren mensajes para el equipo y no cambian direcciones automáticamente. Esta consulta requiere el índice de Firestore declarado en `firestore.indexes.json`; publicá reglas e índices con `firebase deploy --only firestore`.

Los pedidos cuyo reembolso aún se está procesando aparecen en el filtro **Reembolsos** de “Mis compras”, con un aviso visible al abrir la lista y una indicación de que no se despacharán. Desde esa tarjeta se abre el detalle para volver a consultar el resultado o reintentar de forma segura. Las tarjetas y los detalles de compras canceladas no muestran estimaciones ni etapas de envío: distinguen el reembolso en proceso, el reembolso confirmado y la cancelación antes de acreditar el pago.

El checkout limita cada producto a 20 unidades. Las reservas de pago pendientes se recorren en páginas de 500 cada minuto y se liberan al vencer, sin requerir un índice compuesto adicional. El panel Admin muestra las opiniones publicadas en páginas de 25 para evitar consultas y cargas sin límite.

## Correos y páginas de acción de Lúmina

La aplicación incluye un handler visual de Lúmina en `/auth/action` para verificar emails y restablecer contraseñas. La API genera los enlaces con Firebase Admin y los manda desde el servidor por SMTP, así que **no depende de poder editar las plantillas de correo de Firebase**.

Para que el envío sea real, completá Firebase Admin, la URL pública y las credenciales SMTP en `.env.server`. En desarrollo, usá `PUBLIC_APP_URL=http://localhost:5173` y accedé a la tienda con `http://localhost:5173`; los enlaces solo abrirán en esa máquina. En producción, usá el dominio HTTPS publicado y autorizalo en Firebase Authentication.

Para revisar el diseño localmente sin enviar correos ni cambiar contraseñas, abrí `/auth/action?mode=resetPassword&preview=true`. La vista previa desactiva el envío del formulario.

## Qué está implementado

- Catálogo de 40 productos de ejemplo en `src/data/products.ts`, con búsqueda, filtros, carrusel principal, vitrinas horizontales de ofertas y recomendaciones por categorías favoritas.
- Avisos rotativos en la franja superior, y bloqueo del desplazamiento del fondo mientras haya un diálogo abierto.
- Favoritos persistidos en el navegador y bolso de compra con cantidades.
- Registro e inicio de sesión con Firebase Authentication.
- Envío y reenvío de verificación de email, comprobación del estado y recuperación de contraseña.
- Correos transaccionales de verificación/restablecimiento con diseño Lúmina, enviados desde la API con Firebase Admin y SMTP.
- Perfil editable en `users/{userId}` en Firestore, con datos de contacto, domicilio y un indicador visual de completitud. Cada cuenta muestra un avatar ilustrado determinístico generado en el navegador, sin subir imágenes ni requerir Firebase Storage.
- Tema claro/oscuro con preferencia persistida por navegador y selección inicial según el tema del sistema.
- Checkout con Mercado Pago Checkout Pro en sandbox, reserva temporal de stock y pedidos pendientes guardados en Firestore.
- Confirmación de pagos por webhook firmado y consultado contra la API de Mercado Pago; la pantalla de retorno nunca da por aprobado un pago por la URL.
- Páginas de detalle de producto responsive y navegables en `/producto/{id}`, con galería de hasta 8 imágenes, descripción extensa, atributos flexibles, stock, compra con cantidad y opiniones verificadas.
- Centro de notificaciones accesible en el encabezado: confirma en el navegador el pago aprobado al regresar de Mercado Pago y observa cambios de pago, envío y mensajes entrantes. Las compras autenticadas se revisan mediante consultas periódicas mientras la página está abierta, también desde la tienda; no son notificaciones push ni tiempo real. Se guardan hasta 50 avisos por usuario/dispositivo. Los sonidos breves de interacción y de novedades pueden silenciarse por separado desde **Notificaciones → Preferencias**; el navegador solo permite audio después de una interacción del usuario.
- Microinteracciones y animaciones suaves para navegación, tarjetas, avisos, diálogos y paneles, respetando la preferencia de movimiento reducido del sistema.
- Opiniones verificadas con adjuntos en Cloudinary Free: hasta 4 fotos JPEG/PNG/WebP (8 MiB cada una) y un video MP4 (25 MiB), siempre privados hasta su aprobación manual. Los límites de crédito mensual de Cloudinary aplican además de los límites por archivo.
- Panel de administración protegido e independiente en `/admin`, con operaciones de pedidos, catálogo, opiniones, gestión de accesos y preferencias de accesibilidad (escala de texto, alto contraste, movimiento reducido, foco visible y densidad de contenido). Las preferencias se guardan por navegador.
- Favoritos y bolso sincronizados en subcolecciones del usuario autenticado:
  - `users/{userId}/favorites/{productId}`
  - `users/{userId}/cart/{productId}`
- Para visitantes, favoritos y bolso se guardan en el navegador. Al iniciar sesión se combinan con los datos de la cuenta.
- Diseño adaptable a escritorio y móvil.

## Dependencias externas e inventario técnico

El sistema se integra con **4 grupos de APIs externas** y usa **7 plataformas/proveedores externos** al contar también hosting y recursos visuales. Una de esas plataformas de correo se elige por entorno; no hacen falta dos cuentas de correo activas.

| Plataforma/proveedor | Uso | Dependencia |
| --- | --- | --- |
| Firebase Authentication, Firestore y Firebase Admin | Sesiones, verificación de email, perfiles, catálogo, compras, inventario, opiniones y permisos de administración. | Esencial para cuentas y persistencia. |
| Mercado Pago API y webhooks | Preferencias de Checkout Pro, consulta de pagos, confirmación firmada y reembolsos. | Esencial para pagos en línea. |
| Cloudinary API/CDN | Fotos y videos privados de opiniones, vistas previas para moderación y entrega tras aprobación. | Opcional; solo adjuntos. Texto y compras no dependen de esta integración. |
| Brevo API **o** un proveedor SMTP | Envío de correos de verificación y recuperación. Render puede usar Brevo; SMTP es compatible con otros proveedores y desarrollo local. | Se requiere un transporte de correo configurado para enviar mensajes. |
| Render | Ejecución del backend Express y publicación de la tienda. | Plataforma de hosting del despliegue configurado. |
| Google Fonts | Carga de las familias tipográficas Manrope y DM Sans. | Presentación; el contenido y las compras no dependen de sus APIs. |
| Unsplash | Imágenes remotas del catálogo de demostración y piezas editoriales. Las publicaciones propias pueden usar URLs HTTPS públicas. | Recursos visuales externos; no es un backend de imágenes de usuarios. |

**Conteo:** 4 grupos de servicios con API (Firebase, Mercado Pago, Cloudinary y correo), 7 proveedores/plataformas externos listados y 23 dependencias npm directas declaradas en `package.json` (11 de ejecución y 12 de desarrollo). `package-lock.json` fija 424 paquetes totales, contando dependencias transitivas; no son 424 servicios externos.

Las alertas y los sonidos de interfaz se generan en el navegador mediante Web Audio, el tema y las notificaciones se guardan en `localStorage`, y los avatares se generan como SVG local. Estas funciones no dependen de servicios de audio, notificaciones push, hosting de avatar ni cargas de perfil en Firebase Storage. Las actualizaciones de compra se consultan periódicamente con la página abierta; no hay FCM/Web Push ni un canal en tiempo real. El checkout usa Mercado Pago; no se procesa información de tarjetas directamente en Lúmina.

El catálogo inicial de demostración está en `src/data/products.ts`; las publicaciones creadas desde Admin se guardan en Firestore y se combinan con ese catálogo. Las imágenes de producto son URLs públicas HTTPS. Los cambios de favoritos, bolso, perfil, pedidos y publicaciones requieren las reglas de Firestore publicadas desde `firestore.rules`.

Las opiniones se guardan en `productReviews` y sus promedios en `productReviewSummaries`. Los clientes solo pueden leerlas; la API valida la sesión, el email verificado y el registro privado `verifiedPurchases` creado al acreditar un pago antes de aceptar o editar una opinión. Desde Admin se pueden revisar y eliminar opiniones publicadas; al eliminarlas se actualizan los promedios y también se quitan sus adjuntos de Cloudinary. Las reseñas contienen puntuación y comentario de texto; no dependen de almacenamiento de archivos.

El panel Admin vive en la ruta independiente `/admin` y requiere una sesión con rol administrativo validado por la API. Incluye navegación por pedidos, reportes, opiniones, productos, categorías y accesos, modo claro/oscuro, enlace para saltar al contenido, navegación por teclado y preferencias de accesibilidad ajustables. El panel permite ampliar texto, reforzar el contraste, minimizar animaciones, destacar el foco de teclado y compactar el espacio entre registros; esas preferencias se almacenan localmente en el navegador.

La verificación se envía al registrarse; la app permite explorar y guardar mientras tanto y muestra el estado en **Mi cuenta**. Firebase Admin genera enlaces de acción de un solo uso y el servidor los envía en correos de marca mediante SMTP; las plantillas integradas de Firebase ya no se usan para estos dos flujos.

El centro de notificaciones muestra la acreditación confirmada del pago y cambios de pedidos detectados por consultas periódicas mientras la cuenta está activa, así como mensajes entrantes del chat cuando el detalle de esa compra está abierto. No son avisos push ni tiempo real. Los sonidos se sintetizan en el navegador, se pueden silenciar por separado y solo funcionan mientras la tienda permanece abierta. Las preferencias e historial de avisos se guardan localmente por cuenta/dispositivo; el historial está limitado a 50 avisos.

## Decisiones de arquitectura para esta etapa

Firestore funciona como backend administrado para autenticación y datos privados del usuario. Se agregó una API Express pequeña porque Firebase Admin y el envío SMTP requieren credenciales privadas que no deben incluirse en React. La API valida tokens de Firebase para reenviar verificaciones, limita intentos, y da respuestas genéricas en el restablecimiento para no revelar si un email está registrado.

Los pagos se integran con **Mercado Pago Checkout Pro**, empezando en sandbox: la tienda no recibe ni guarda datos de tarjetas, y los pagos de prueba no mueven dinero real. La API vuelve a calcular los importes desde el catálogo confiable, reserva stock durante 30 minutos y crea el pedido pendiente. El servidor acredita los pagos mediante webhooks firmados y consulta la API de Mercado Pago para verificar cada transacción. Al volver del checkout, el cliente autenticado también puede solicitar una conciliación del pago; el servidor valida que Mercado Pago asocie el pago al pedido, que importe y moneda coincidan y que el modo sea el esperado antes de actualizarlo. Nunca se confía en el estado de pago indicado por la URL del navegador. Las reservas vencidas se liberan periódicamente. Las opiniones son de texto y admiten adjuntos opcionales moderados en Cloudinary.

### Probar pagos sin dinero real

Mercado Pago ofrece un entorno de pruebas real (sandbox), no hace falta usar una tarjeta ni una cuenta con dinero real:

1. Creá una aplicación de prueba en [Tus integraciones de Mercado Pago](https://www.mercadopago.com.ar/developers/panel/app) y usá el Access Token que aparece en **Pruebas → Credenciales de prueba**, junto con el secreto de firma de notificaciones. Configuralos solo como secretos del servidor. El usuario y la contraseña de prueba son para iniciar sesión en el checkout, no para configurar el servidor.
2. Creá un usuario comprador de prueba desde el panel de desarrolladores siguiendo la [guía oficial de usuarios de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/integration-test/test-users). Usá credenciales sandbox distintas de las de tu cuenta habitual.
3. Configurá la URL de notificaciones `https://TU-SERVICIO.onrender.com/api/payments/mercadopago/webhook`, seleccionando el evento de pagos y el secreto de firma correspondiente.
4. Iniciá sesión en la tienda con una cuenta de cliente Firebase cuyo email esté verificado, agregá un producto y continuá a Checkout Pro. En Mercado Pago autenticá el usuario comprador de prueba; para tarjetas, usá una [tarjeta de prueba y los datos de titular documentados oficialmente](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases).
5. Hacé la prueba en una ventana incógnita, como recomienda Mercado Pago. El webhook firmado actualiza el pedido; al volver del checkout, la tienda también pide al servidor conciliar el pago usando su identificador de retorno o, si no vino en la URL, buscando por la referencia del pedido. El servidor consulta Mercado Pago y valida la asociación, el importe, la moneda y el modo antes de acreditarlo; el cliente solo puede leer sus propios pedidos según `firestore.rules`. Confirmá también el estado y el stock desde el panel Admin. Después de la compra acreditada, esa cuenta podrá publicar o editar una única reseña por producto.

La opción de probar la URL de notificaciones en el panel de Mercado Pago puede enviar un ejemplo con un ID ficticio (por ejemplo, `123456`) que no representa un pago real. Si ese ejemplo llega sin una firma válida, la API responde `401` y lo registra en Render; es correcto y no se debe desactivar la verificación de firma para hacer que pase esa prueba. Verificá el flujo completando un pago sandbox: el webhook real debe llevar firma y la tienda también consulta el pago directamente al volver del checkout.

Mientras no estén configurados el token y el secreto sandbox, el checkout devuelve un error explícito y no se genera ningún cobro. El modo productivo sigue bloqueado; no uses credenciales reales para estas pruebas.

### Habilitar y administrar el panel

Para probar el panel sin tener acceso a una casilla de correo, creá una cuenta de prueba directamente en **Firebase Console → Authentication → Users → Add user**. Usá un email con formato válido y una contraseña de prueba; no hace falta verificar ese email para esta forma de asignar el rol. Después:

1. Copiá el UID de la cuenta recién creada.
2. En **Firestore Database → Data**, creá la colección `admins` si todavía no existe y agregá un documento cuyo ID sea exactamente ese UID.
3. Agregá el campo `active` de tipo booleano con valor `true`.
4. Iniciá sesión en la tienda con el email y contraseña de prueba. Si ya tenías sesión abierta, cerrala y volvé a entrar; debería aparecer el botón **Admin**.

Hacé esta prueba **solo en el proyecto Firebase de desarrollo** y comprobá que el frontend (`VITE_FIREBASE_PROJECT_ID`), el backend (`FIREBASE_PROJECT_ID`) y la cuenta de servicio de Firebase Admin correspondan al mismo proyecto. No publiques el acceso de una cuenta de prueba en el Firebase de producción: quien tenga esa cuenta podrá administrar productos y pedidos. La consola de Firebase permite crear el documento aunque las reglas nieguen las escrituras del navegador; no hace falta volver a desplegar reglas para este cambio.

Para una cuenta real del equipo, también se puede agregar su email verificado a `ADMIN_EMAILS` en el entorno del servidor: en Render, **Environment**; en local, `.env.server`. Separá varios emails con comas y reiniciá o desplegá la API. Al validar el permiso, la API crea también `admins/{uid}`.

Una vez que ya exista un administrador, desde **Admin → Accesos** puede otorgar el rol a otra cuenta existente y verificada, o quitarse su propio acceso. La revocación se valida en el servidor, actualiza `admins/{uid}` a `active: false` y recarga la página; no permite revocar a otra cuenta. La API verifica la cuenta con Firebase Authentication al otorgar permisos y escribe los documentos usando Firebase Admin. Las reglas de Firestore siguen rechazando escrituras de clientes a `admins`. Mantené privada la cuenta de servicio del servidor. Los demás usuarios pueden ver productos y crear pedidos propios, pero no administrar publicaciones ni leer pedidos ajenos.

Los permisos de bootstrap configurados en `ADMIN_EMAILS` se asignan automáticamente si la cuenta todavía no tiene un documento `admins/{uid}`. Un documento existente con `active: false` prevalece sobre `ADMIN_EMAILS`, así que un administrador de bootstrap también puede revocarse el acceso desde el panel. Para volver a habilitarlo, otro administrador puede otorgarle acceso desde el panel o se puede eliminar el documento inactivo en Firestore mientras su email siga en `ADMIN_EMAILS`.

Los productos nuevos se publican desde el panel con nombre, categoría, descripción de hasta 5000 caracteres, precio, stock y entre 5 y 8 fotos HTTPS distintas; las imágenes seleccionadas desde el dispositivo se cargan a Cloudinary. El panel también permite agregar hasta 30 características y 30 especificaciones por producto como pares independientes de nombre/valor, para adaptarse a cada categoría. La página muestra únicamente estos datos cuando fueron cargados; no inventa garantías, devoluciones, factura, cantidades vendidas, etiquetas de ventas ni beneficios.

La compra desde la ficha agrega la cantidad seleccionada al bolso y respeta el stock que conoce el catálogo. La API de checkout sigue siendo la validación final de precios y disponibilidad. Las opciones de cuotas dependen de la respuesta de Mercado Pago para cada compra y no se prometen antes del checkout. Como la tienda aún maneja un único vendedor, la ficha identifica a Lúmina y no simula ofertas de otros comercios ni un catálogo de minoristas.

Las reseñas de la ficha admiten puntuación y comentarios de compradores verificados. Pueden incluir fotos y un video de Cloudinary que requieren moderación antes de publicarse. Tampoco se incluyen preguntas públicas/respuestas del vendedor en esta etapa.

Los productos de ejemplo conservan su catálogo inicial y comienzan con un stock de demostración; al procesar compras, la API lo descuenta de forma atómica. Ocultar un producto lo saca de la tienda sin borrar su historial.

El panel revisa pedidos nuevos mientras está abierto y muestra el cliente, la entrega, los artículos, los totales y el estado. Al cerrar o recargar el panel, los pedidos siguen guardados en Firestore.

## Probar en Render (versión de prueba)

El archivo [`render.yaml`](./render.yaml) define un único servicio web gratuito para pruebas. Render instala las dependencias, compila React y arranca Express; Express sirve `dist/` y la API `/api` desde el mismo dominio. El checkout permanece deshabilitado hasta configurar las credenciales sandbox de Mercado Pago.

1. Subí este proyecto a un repositorio privado de GitHub y conectalo desde Render con **New → Blueprint**.
2. Render va a pedir las variables Firebase y de Mercado Pago marcadas como `sync: false`. Obtené las `VITE_FIREBASE_*` de la configuración de tu aplicación web en Firebase; `FIREBASE_PROJECT_ID` debe ser el ID del mismo proyecto usado por la cuenta de servicio. `ADMIN_EMAILS` es opcional si ya existe un documento Admin en Firestore; si no, completalo con el email verificado del primer administrador (separá varias cuentas con comas). Estos valores `VITE_*` son configuración pública de cliente y quedan incluidos en el frontend; nunca pongas allí credenciales privadas.
3. En **Environment → Secret Files**, agregá `lumina-service-account.json` con la clave de cuenta de servicio del proyecto Firebase. El blueprint ya apunta `GOOGLE_APPLICATION_CREDENTIALS` a `/etc/secrets/lumina-service-account.json`. Protegé ese archivo y no lo agregues al repositorio.
4. Esperá a que termine el deploy y abrí la URL `onrender.com`. En Firebase Authentication, agregá ese dominio en **Authorized domains**. Publicá las reglas e índices de [`firestore.rules`](./firestore.rules) y [`firestore.indexes.json`](./firestore.indexes.json) con `firebase deploy --only firestore`.
5. En el panel de desarrolladores de Mercado Pago, creá una aplicación de prueba y copiá el Access Token que aparece en **Pruebas → Credenciales de prueba**. Configurá ese valor y el `MERCADO_PAGO_WEBHOOK_SECRET` como secretos en Render. Dejá `MERCADO_PAGO_MODE=sandbox`. Configurá la URL de notificaciones como `https://TU-SERVICIO.onrender.com/api/payments/mercadopago/webhook` y el mismo secreto de firma en Render. Para probar, iniciá el checkout en una ventana de incógnito con una **cuenta compradora de prueba** de Mercado Pago (distinta de la cuenta vendedora); no uses datos de tarjetas reales. Elegí **Elegir otro medio de pago** e ingresá una tarjeta de prueba de la documentación de Mercado Pago, su vencimiento y código de seguridad, y el titular `APRO` con DNI `12345678` para simular un pago aprobado.
6. Comprobá `https://TU-SERVICIO.onrender.com/api/health`. La API informa si Firebase Admin, correo y credenciales de pago están configurados, sin revelar secretos. El endpoint de pagos responde `503` hasta que estén configurados los secretos sandbox. El correo es opcional para navegar/probar el resto; sin un proveedor configurado no se enviarán correos de verificación ni recuperación.

Para enviar correos desde Render, se puede usar la API HTTPS de Brevo: agregá `BREVO_API_KEY` con una clave API privada y `EMAIL_FROM` con un remitente verificado, por ejemplo `Lúmina <tienda@tudominio.com>`. Al estar configurada, la aplicación elige esta opción antes que SMTP. Guardá la clave solo en Environment de Render, nunca en `VITE_*` ni en Git. El endpoint de salud informa el transporte elegido (`emailTransport`), pero no envía un mensaje de prueba.

La URL pública se detecta desde Render automáticamente. Si más adelante configurás `PUBLIC_APP_URL`, debe ser el origen HTTPS exacto del servicio; Mercado Pago la usa para los retornos y el webhook. El plan gratuito puede suspender el servicio cuando no se usa y tardar en iniciar al volver a abrirlo. La aplicación mantiene bloqueado el modo productivo salvo habilitación explícita en el servidor; no uses este deploy para ventas reales.

En desarrollo local se mantiene el proxy `/api` de Vite; `npm run dev:full` inicia Vite y Express en paralelo. No despliegues la clave de servicio ni credenciales SMTP en el frontend o en variables `VITE_*`.

## Comandos

```powershell
npm install
npm run dev
npm run dev:api
npm run dev:full
npm run lint
npm run build
npm run typecheck:api
npm test
```

`npm test` ejecuta pruebas unitarias de la lógica pura de reportes con `node:test` y `tsx`. El proyecto aún no tiene pruebas end-to-end contra Firebase, Mercado Pago, Cloudinary o email; esas integraciones requieren entornos de prueba y credenciales aisladas.

## Despliegue y puntos pendientes

El despliegue configurado usa [`render.yaml`](./render.yaml): Render compila la SPA y ejecuta Express desde el mismo origen. Firebase Authentication debe autorizar el dominio publicado y las reglas/índices se publican con `firebase deploy --only firestore`. Mercado Pago debe permanecer en sandbox hasta completar una revisión operativa propia y configurar las credenciales y el webhook de producción de forma explícita.

Puntos conocidos: `src/App.tsx` y `server/index.ts` concentran todavía muchas responsabilidades; la extracción de lógica de negocio a módulos independientes debe continuar de forma incremental. Los informes recorren como máximo 20.000 pedidos por consulta y devuelven un error explícito al superar ese límite para no presentar totales parciales. El reporte utiliza estados actuales y fecha original del pedido, no una bitácora contable de eventos de pago. Faltan pruebas automatizadas de integración para Firestore Rules y proveedores externos. No se implementaron facturación fiscal, multi-vendedor, notificaciones push ni tracking geográfico en vivo.
