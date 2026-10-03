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
4. Para desarrollo local, completá `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` con las credenciales SMTP de un proveedor de email. El servidor aplica tiempos máximos de conexión y respuesta para que un SMTP inaccesible no deje la solicitud cargando indefinidamente.
5. Para desarrollo local, dejá `PUBLIC_APP_URL=http://localhost:5173` y abrí la tienda usando esa misma dirección. Para enviar enlaces a clientes, debe ser la URL HTTPS pública donde esté publicada la tienda, y ese dominio debe estar autorizado en Firebase Authentication.

**No compartas ni subas la clave privada JSON ni las credenciales SMTP.** La cuenta de servicio da acceso administrativo al proyecto; mantenela solo en `secrets/` local y configurala como secreto en el servidor al desplegar.

Para habilitar el checkout sandbox en local, agregá en `.env.server` `MERCADO_PAGO_MODE=sandbox`, el Access Token que figura en **Pruebas → Credenciales de prueba** como `MERCADO_PAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET=...`. No uses el usuario ni la contraseña de prueba como Access Token. El secreto debe ser el de la notificación configurada para el evento `payment`. No configures estas variables como `VITE_*`; no habilites `MERCADO_PAGO_ALLOW_PRODUCTION` en esta etapa.

`npm run dev:full` inicia Vite y la API Express local; Vite reenvía `/api` al puerto `3001`. El endpoint `/api/health` permite ver si Firebase Admin y SMTP están configurados, sin exponer sus valores.

En Firebase Console:

1. Creá un proyecto y registrá una aplicación web.
2. En **Authentication → Sign-in method**, habilitá **Email/Password**.
3. En **Authentication → Settings → Authorized domains**, verificá que `localhost` esté permitido para desarrollo.
4. Creá una base de **Cloud Firestore**.
5. Publicá las reglas e índices de Firestore con `firebase deploy --only firestore`; el proyecto usa [`firestore.rules`](./firestore.rules) y [`firestore.indexes.json`](./firestore.indexes.json).

La configuración pública de Firebase que usa la aplicación no reemplaza las reglas de seguridad: aplicá siempre reglas en Firebase y restringí las claves desde la consola cuando corresponda. Las reglas incluidas dejan el catálogo legible, bloquean su escritura desde el cliente y limitan los perfiles a su propio usuario.

En **Mi cuenta → Mis compras**, cada cliente autenticado puede consultar sus últimos 50 pedidos y abrir el detalle con productos, fotos, fecha y hora, medio de pago disponible, rango estimado de entrega y progreso local o internacional. Administración configura por pedido el tipo de envío, las fechas, la etapa, una novedad visible y opcionalmente el transportista/código/enlace de seguimiento; la ubicación en vivo depende de la empresa de correo y no está integrada. Cliente y administración pueden intercambiar mensajes asincrónicos asociados al pedido. Las opciones de ayuda crean mensajes para el vendedor y no cancelan compras ni cambian direcciones automáticamente. Esta consulta requiere el índice de Firestore declarado en `firestore.indexes.json`; publicá reglas e índices con `firebase deploy --only firestore`.

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
- Perfil editable en `users/{userId}` en Firestore, con datos de contacto, domicilio y un indicador visual de completitud.
- Checkout con Mercado Pago Checkout Pro en sandbox, reserva temporal de stock y pedidos pendientes guardados en Firestore.
- Confirmación de pagos por webhook firmado y consultado contra la API de Mercado Pago; la pantalla de retorno nunca da por aprobado un pago por la URL.
- Fichas con puntuación agregada y opiniones; solo pueden publicarlas cuentas verificadas con una compra aprobada del producto.
- Panel de administración protegido para publicaciones, disponibilidad, stock, seguimiento de pedidos pagados y asignación de rol Admin por email.
- Favoritos y bolso sincronizados en subcolecciones del usuario autenticado:
  - `users/{userId}/favorites/{productId}`
  - `users/{userId}/cart/{productId}`
- Para visitantes, favoritos y bolso se guardan en el navegador. Al iniciar sesión se combinan con los datos de la cuenta.
- Diseño adaptable a escritorio y móvil.

El catálogo inicial de demostración está en `src/data/products.ts`; las publicaciones creadas desde Admin se guardan en Firestore y se combinan con ese catálogo. Las imágenes son URLs públicas HTTPS. Los cambios de favoritos, bolso, perfil, pedidos y publicaciones requieren las reglas de Firestore publicadas desde `firestore.rules`.

Las opiniones se guardan en `productReviews` y sus promedios en `productReviewSummaries`. Los clientes solo pueden leerlas; la API valida la sesión, el email verificado y el registro privado `verifiedPurchases` creado al acreditar un pago antes de aceptar o editar una opinión. Publicá reglas e índices con `firebase deploy --only firestore` para habilitar la lectura pública, ordenar opiniones recientes y mantener bloqueadas las escrituras directas desde el navegador.

La verificación se envía al registrarse; la app permite explorar y guardar mientras tanto y muestra el estado en **Mi cuenta**. Firebase Admin genera enlaces de acción de un solo uso y el servidor los envía en correos de marca mediante SMTP; las plantillas integradas de Firebase ya no se usan para estos dos flujos.

## Decisiones de arquitectura para esta etapa

Firestore funciona como backend administrado para autenticación y datos privados del usuario. Se agregó una API Express pequeña porque Firebase Admin y el envío SMTP requieren credenciales privadas que no deben incluirse en React. La API valida tokens de Firebase para reenviar verificaciones, limita intentos, y da respuestas genéricas en el restablecimiento para no revelar si un email está registrado.

Los pagos se integran con **Mercado Pago Checkout Pro**, empezando en sandbox: la tienda no recibe ni guarda datos de tarjetas, y los pagos de prueba no mueven dinero real. La API vuelve a calcular los importes desde el catálogo confiable, reserva stock durante 30 minutos y crea el pedido pendiente. El servidor acredita los pagos mediante webhooks firmados y consulta la API de Mercado Pago para verificar cada transacción. Al volver del checkout, el cliente autenticado también puede solicitar una conciliación del pago; el servidor valida que Mercado Pago asocie el pago al pedido, que importe y moneda coincidan y que el modo sea el esperado antes de actualizarlo. Nunca se confía en el estado de pago indicado por la URL del navegador. Las reservas vencidas se liberan periódicamente. Las publicaciones se guardan en `products/{productId}` y usan una URL HTTPS de imagen para evitar Storage.

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

El primer administrador se habilita desde el servidor; no se puede crear ni cambiar el permiso directamente desde la web o el cliente Firebase. En Render, agregá `ADMIN_EMAILS` en **Environment** con el email verificado de la cuenta inicial. Para más de una cuenta inicial, separá los emails con comas. En local, agregá la misma variable a `.env.server`. Reiniciá o desplegá la API e iniciá sesión nuevamente para que aparezca el botón **Admin**. Al validar el permiso, la API crea también `admins/{uid}` para que las reglas de Firestore apliquen el rol de forma consistente.

Como alternativa, el primer documento puede cargarse manualmente:

1. Iniciá sesión en la tienda con la cuenta que va a administrar el catálogo.
2. En Firebase Console, abrí **Authentication → Users** y copiá el UID de esa cuenta.
3. Abrí **Firestore Database → Data**, creá la colección `admins` si todavía no existe y agregá un documento cuyo ID sea exactamente ese UID.
4. En ese documento agregá el campo `active` de tipo booleano con valor `true`.
5. Publicá las reglas de Firestore con `firebase deploy --only firestore`. Reiniciá la sesión para que aparezca el botón **Admin**.

Desde **Admin → Accesos**, un administrador puede ingresar el email de otra cuenta existente y verificada para otorgarle el rol. La API verifica la cuenta con Firebase Authentication y escribe `admins/{uid}` usando Firebase Admin; los emails inexistentes, las cuentas sin verificar y las cuentas comunes no pueden usar este endpoint. Las reglas de Firestore siguen rechazando escrituras de clientes a `admins`. Mantené la cuenta de servicio del servidor privada. Los demás usuarios pueden ver productos y crear pedidos propios, pero no administrar publicaciones ni leer pedidos ajenos.

Los permisos de bootstrap configurados en `ADMIN_EMAILS` son administradores raíz: quitar un email de esa variable no desactiva un documento `admins/{uid}` que ya se haya creado para la cuenta. Para revocar un permiso otorgado desde el panel o Firebase Console, cambiá `active` a `false`; para revocar también un administrador de bootstrap, primero quitá su email de `ADMIN_EMAILS` y luego desactivá su documento.

Los productos nuevos se publican desde el panel con nombre, categoría, descripción, precio, stock y URL de imagen HTTPS. Los productos de ejemplo conservan su catálogo inicial y comienzan con un stock de demostración; al procesar compras, la API lo descuenta de forma atómica. Ocultar un producto lo saca de la tienda sin borrar su historial.

El panel revisa pedidos nuevos mientras está abierto y muestra el cliente, la entrega, los artículos, los totales y el estado. Al cerrar o recargar el panel, los pedidos siguen guardados en Firestore.

## Probar en Render (versión de prueba)

El archivo [`render.yaml`](./render.yaml) define un único servicio web gratuito para pruebas. Render instala las dependencias, compila React y arranca Express; Express sirve `dist/` y la API `/api` desde el mismo dominio. El checkout permanece deshabilitado hasta configurar las credenciales sandbox de Mercado Pago.

1. Subí este proyecto a un repositorio privado de GitHub y conectalo desde Render con **New → Blueprint**.
2. Render va a pedir las variables Firebase y de Mercado Pago marcadas como `sync: false`. Obtené las `VITE_FIREBASE_*` de la configuración de tu aplicación web en Firebase; `FIREBASE_PROJECT_ID` debe ser el ID del mismo proyecto. `ADMIN_EMAILS` es opcional si ya existe un documento Admin en Firestore; si no, completalo con el email verificado del primer administrador (separá varias cuentas con comas). Estos valores `VITE_*` son configuración pública de cliente y quedan incluidos en el frontend; nunca pongas allí credenciales privadas.
3. En **Environment → Secret Files**, agregá `lumina-service-account.json` con la clave de cuenta de servicio del proyecto Firebase. El blueprint ya apunta `GOOGLE_APPLICATION_CREDENTIALS` a `/etc/secrets/lumina-service-account.json`. Protegé ese archivo y no lo agregues al repositorio.
4. Esperá a que termine el deploy y abrí la URL `onrender.com`. En Firebase Authentication, agregá ese dominio en **Authorized domains**. Publicá las reglas e índices de [`firestore.rules`](./firestore.rules) y [`firestore.indexes.json`](./firestore.indexes.json) con `firebase deploy --only firestore`.
5. En el panel de desarrolladores de Mercado Pago, creá una aplicación de prueba y copiá el Access Token que aparece en **Pruebas → Credenciales de prueba**. Configurá ese valor y el `MERCADO_PAGO_WEBHOOK_SECRET` como secretos en Render. Dejá `MERCADO_PAGO_MODE=sandbox`. Configurá la URL de notificaciones como `https://TU-SERVICIO.onrender.com/api/payments/mercadopago/webhook` y el mismo secreto de firma en Render. Para probar, iniciá el checkout en una ventana de incógnito con una **cuenta compradora de prueba** de Mercado Pago (distinta de la cuenta vendedora); no uses datos de tarjetas reales. Elegí **Elegir otro medio de pago** e ingresá una tarjeta de prueba de la documentación de Mercado Pago, su vencimiento y código de seguridad, y el titular `APRO` con DNI `12345678` para simular un pago aprobado.
6. Comprobá `https://TU-SERVICIO.onrender.com/api/health`. La API informa si Firebase Admin, correo y credenciales de pago están configurados, sin revelar secretos. El endpoint de pagos responde `503` hasta que estén configurados los secretos sandbox. El correo es opcional para navegar/probar el resto; sin un proveedor configurado no se enviarán correos de verificación ni recuperación.

Para enviar correos desde Render, se puede usar la API HTTPS de Brevo: agregá `BREVO_API_KEY` con una clave API privada y `EMAIL_FROM` con un remitente verificado, por ejemplo `Lúmina <tienda@tudominio.com>`. Al estar configurada, la aplicación elige esta opción antes que SMTP. Guardá la clave solo en Environment de Render, nunca en `VITE_*` ni en Git. El endpoint de salud informa el transporte elegido (`emailTransport`), pero no envía un mensaje de prueba.

La URL pública se detecta desde Render automáticamente. Si más adelante configurás `PUBLIC_APP_URL`, debe ser el origen HTTPS exacto del servicio; Mercado Pago la usa para los retornos y el webhook. El plan gratuito puede suspender el servicio cuando no se usa y tardar en iniciar al volver a abrirlo. La aplicación mantiene bloqueado el modo productivo salvo habilitación explícita en el servidor; no uses este deploy para ventas reales.

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

1. Completar pruebas de pagos con credenciales sandbox y usuarios de prueba antes de evaluar una habilitación productiva.
2. Integrar notificaciones de mensajería y seguimiento en vivo cuando se defina una plataforma de correo compatible.
3. Mejorar el panel con filtros, métricas y carga de imágenes cuando exista una solución de almacenamiento aprobada.
4. Implementar recomendaciones iniciales por categoría y popularidad.
