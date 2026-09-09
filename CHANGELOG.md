# Changelog

Este proyecto sigue [SemVer](https://semver.org/lang/es/). Hasta 1.0.0 la API publica puede cambiar entre versiones
menores; los cambios incompatibles se listan aqui.

## 0.1.0-alpha.1 - 2026-09-07

Primera version publica. Paquetes: `@relaykit/core`, `@relaykit/web`, `@relaykit/matrix-js`,
`@relaykit/browser-storage` y `@relaykit/in-memory`.

### Anadido

- Cliente headless `MessagingClient` con login, restauracion de sesion, sync, reconexion y eventos tipados.
- Conversaciones: listado ordenado por actividad reciente con `lastMessage` y `unreadCount`, creacion,
  invitaciones, union, conversaciones directas sin duplicados (`open`, `findDirect`), busqueda local y typing.
- Mensajes: timeline, paginacion con `hasMore`, envio con local echo, edicion, eliminacion, reacciones, receipts y busqueda local.
- Outbox persistente e idempotente: transaction IDs, backoff con limite de intentos, recuperacion tras reinicio,
  cancelacion y deduplicacion de eco remoto.
- Adjuntos con progreso, cifrado en rooms E2EE, paso por el outbox y descarga autenticada.
- Perfiles: `users.profile` devuelve nombre visible e identificador de avatar, y `users.avatar` descarga la
  imagen con su tipo de contenido.
- Gestion de conversaciones: `conversations.invite`, `conversations.rename` y `conversations.leave`, que ademas
  borra del almacen local lo que ya no pertenece al usuario.
- Al recuperar la conexion se reenvia todo lo que quedo en la cola, sin esperar al backoff. Lo que agoto sus
  intentos sigue esperando una decision explicita.
- La cache local deja de crecer sin limite: conserva los 500 ultimos mensajes entregados por conversacion,
  configurable con `cache.messagesPerConversation`, y nunca descarta lo que sigue en la cola de envio.
- Los participantes de una conversacion ya no incluyen a quien la abandono o fue expulsado.
- Verificado el mismo usuario en dos dispositivos a la vez: se leen entre si en una sala cifrada y marcar como
  leido en uno limpia el contador en el otro.
- Un mensaje que no se puede descifrar llega marcado con `undecryptable` y el cuerpo vacio, en vez de con el texto
  interno de `matrix-js-sdk`.
- `conversations.open` se une a la invitacion directa de ese usuario en vez de crear una segunda conversacion, que
  dejaba a cada lado hablando en su propia sala.
- Listas vivas: `createConversationList` y `createMessageTimeline` mantienen al dia una lista de conversaciones o
  el hilo de una conversacion, resolviendo el eco local y el orden, y se conectan a React con `useSyncExternalStore`.
- `messages.readBy` responde quien ha leido un mensaje y cuando, sin que la aplicacion tenga que seguir los
  recibos de lectura por su cuenta.
- Miniaturas: `sendFile` acepta una miniatura junto al archivo, se cifra igual que el original y se descarga por
  separado con `media.download`, sin traerse el archivo completo.
- Listar conversaciones y mensajes solo escribe en el almacen local lo que ha cambiado, en vez de reescribirlo todo
  en cada llamada.
- Respuestas: `messages.send` acepta `{ replyTo }` y los mensajes traen `replyToId`, tambien si la respuesta
  quedo en la cola y sale despues de un reinicio.
- Evento `notification` para saber que mensajes merecen avisar al usuario, segun las reglas del homeserver, con
  aviso de mencion y sin avisar nunca de los mensajes propios.
- E2EE con crypto Rust de `matrix-js-sdk`: rooms cifrados por defecto, estado de dispositivos, key backup,
  recovery key (`crypto.setupRecovery`, `crypto.recover`) y verificacion interactiva SAS (`client.verification`).
- Eventos remotos: ediciones y redactions persistidas, typing, receipts y presencia recibidos.
- Storage IndexedDB cifrado para mensajes, outbox y adjuntos en cola; purga completa en `logout()`. Los registros
  escritos con otro secreto se descartan al leerlos en vez de romper la aplicacion.
- Smokes E2E contra Synapse real: chat cifrado con adjunto, recovery entre dispositivos y verificacion SAS.
- Ejemplo web con adjuntos, progreso de subida, descarga, estados de envio y reintento o cancelacion.
- Ejemplo Electron que comprueba el SDK en un renderer real y guarda la clave del storage en el llavero del
  sistema con `safeStorage` y un preload bridge.

### Licencia

Apache-2.0.

### Corregido antes de publicar

- El adapter Matrix perdia el `transactionId` al enviar, asi que una aplicacion no podia reconciliar su eco local
  y pintaba el mensaje dos veces.
- Reintentar un envio fallido contra Matrix fallaba con `addPendingEvent called on an event with known txnId`:
  `matrix-js-sdk` rechaza reencolar un evento con un id de transaccion ya usado en la sesion. Ahora se reenvia el
  evento pendiente y el mensaje sale. Sin esto el outbox no recuperaba ningun envio fallido sin reiniciar.
- Ambos fallos los encontraron los contract tests al correr la misma suite contra los dos adapters.
- Los errores del homeserver ya no se filtran en crudo: el adapter Matrix los traduce todos a `SdkError`, con los
  codigos `RATE_LIMITED` (con `retryAfterMs`) e `INVALID_SESSION` para los casos que una aplicacion debe
  distinguir, y `ADAPTER_ERROR` con el motivo del servidor para el resto.
- `@relaykit/web` no creaba storage local si la sesion llegaba por `login()` en vez de por el constructor, que es
  el flujo documentado: la aplicacion se quedaba sin cache, sin outbox persistente y sin nada offline.
- Enviar justo despues de crear una conversacion podia fallar aunque el homeserver aceptara el mensaje, porque el
  adapter exigia tener la sala en su cache local. Subir un adjunto ahora espera a conocer la sala, para no publicar
  nunca un archivo en claro en una sala cifrada.
- Un envio fallido ya no pierde la causa: `SdkError` la incluye y conserva los errores tipados del adapter.

### Limitaciones conocidas

- Sin thumbnails ni cache local de descargas.
- Sin busqueda remota, sin verificacion por QR y sin verificacion de otros usuarios sin indicar dispositivo.
- La clave del storage local se deriva por defecto del access token; usar `storageSecret` en produccion.
- Una clave de sala creada despues de activar la recuperacion puede tardar en llegar al key backup hasta el
  siguiente arranque; activar la recuperacion antes de empezar a enviar.
- Sin paquetes React, Vue ni integracion Electron especifica.
