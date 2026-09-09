# Roadmap de Produccion

## Estado actual

RelayKit ya tiene un MVP funcional para Web y Electron basado en TypeScript y `matrix-js-sdk`.

Validado manualmente en navegador:

- login de dos usuarios
- sync Matrix
- rooms cifrados
- invitaciones y union
- envio y recepcion en tiempo real
- persistencia local
- local echo
- deduplicacion
- reintentos basicos

El smoke E2E Node esta preparado en `scripts/smoke-relaykit.mjs`, pero la ultima ejecucion quedo bloqueada porque
Docker Desktop no estaba disponible.

## Fase 1: smoke E2E

- Levantar Synapse automaticamente en CI.
- Crear dos usuarios efimeros.
- Crear un room cifrado.
- Unir el segundo usuario.
- Enviar un mensaje con transaction ID.
- Verificar descifrado en el timeline.
- Verificar entrega mediante evento live.
- Cerrar ambos clientes siempre, incluso si falla el smoke.

## Fase 2: persistencia segura

- Separar claramente Matrix crypto store y application store.
- No persistir cuerpos descifrados sin proteccion.
- Crear storage cifrado para browser.
- Derivar o inyectar una clave por dispositivo.
- Limpiar claves y datos al hacer logout o purge. Cubierto: `logout()` llama a `storage.clear()`; `stop()` conserva
  los datos para reanudar la sesion (`tests/lifecycle.test.mjs`).
- Documentar que E2EE de transporte no protege automaticamente el disco local.
- Crecimiento del storage: cubierto con un limite de mensajes cacheados por conversacion. Pendiente: limitar
  tambien el numero de conversaciones cacheadas.
- Rotacion de la clave de cifrado del storage: los registros ilegibles se descartan al leerlos en vez de romper
  todas las lecturas, y la cache se rellena desde el servidor. Pendiente: re-cifrado en caliente para conservarla.

## Fase 3: outbox de produccion

Cubierto (tests en `tests/outbox.test.mjs`):

- Persistir operaciones pendientes, no solo mensajes materializados.
- Mantener transaction ID durante todo el ciclo de retry.
- Backoff exponencial con limite.
- Recuperar operaciones despues de reiniciar, incluidas las interrumpidas en `processing` y las que perdieron su
  registro de mensaje.
- Evitar dos workers procesando la misma operacion.
- Procesar el outbox en orden de creacion.
- Resolver remote echo y local echo sin duplicados.

- Cancelacion manual con `messages.cancel(id)`: elimina la operacion y el mensaje local y emite `message.updated`
  con estado `cancelled`.
- Limite de 8 intentos automaticos; despues solo se reintenta manualmente con `messages.retry(id)`.

## Fase 4: E2EE completo

Cubierto:

- Estado de dispositivos y verificacion manual (`devices.verification`, `devices.verify`).
- Cross-signing y secret storage con `crypto.setupRecovery({ password? })`, que devuelve la recovery key.
- Backup y restore de claves con `crypto.recover(recoveryKey)`.
- Validado contra Synapse real con dos dispositivos en `scripts/smoke-recovery.mjs` (`npm run smoke:recovery`).

- Verificacion interactiva SAS entre dispositivos (`client.verification`), validada contra Synapse en
  `scripts/smoke-verification.mjs` (`npm run smoke:verification`).
- `logout()` revoca la sesion en el servidor antes de parar el adapter (antes se paraba primero y el token seguia
  valido, acumulando dispositivos).

Pendiente:

- Forzar la subida al backup de las claves creadas despues de activar la recuperacion: `matrix-js-sdk` solo
  ejecuta el bucle de subida al habilitar el backup y no lo repite al enviar.
- Verificacion por QR y verificacion de otros usuarios sin indicar dispositivo (requiere DM).
- Eventos no descifrables: cubierto, llegan marcados con `undecryptable` y sin cuerpo.
- Rotacion y revocacion.
- Tests con dos usuarios y multiples dispositivos.

## Fase 5: eventos Matrix

Cubierto (tests en `tests/remote-events.test.mjs` y `tests/matrix-mapper.test.mjs`):

- Redactions remotas de mensajes, persistidas y emitidas como `message.updated`.
- Reacciones eliminadas.
- Receipts enviados y recibidos (`receipt.received`), y consulta de quien leyo un mensaje con `messages.readBy`.
- Typing indicators recibidos (`typing.changed`).
- Presence recibida (`presence.changed`).
- Ediciones remotas, incluidas las cifradas, persistidas antes de emitirse.

- Cambios de membership de otros participantes: llegan como `conversation.updated` con la lista de participantes
  actualizada, verificado contra Synapse en el smoke E2E y en el de grupo con tres personas.
- Varios dispositivos del mismo usuario: cubierto con `scripts/smoke-devices.mjs`, que comprueba que se leen entre
  si en una sala cifrada y que el estado de lectura es de la persona, no del dispositivo.
- Pendiente: distinguir en `Conversation` quien ha aceptado y quien sigue invitado. Hoy `participantIds` los junta.
- Grupos: cubierto con `scripts/smoke-group.mjs`, que comprueba que los tres se leen entre si en una sala cifrada,
  los no leidos y que el grupo encoge cuando alguien se va. Pendiente: grupos grandes y expulsar participantes.

Pendiente:

- Orden y deduplicacion de receipts y presence repetidos.
- Validar typing y presence contra Synapse real en el smoke E2E.

## Fase 6: API y UX

- Perfiles: cubierto con `users.profile` y `users.avatar`, en el contract test de ambos adapters. Pendiente:
  nombres por conversacion, que en Matrix pueden diferir del perfil global.
- Gestion de conversaciones: cubierto invitar, renombrar y salir, en el contract test de ambos adapters.
  Pendiente: expulsar y bloquear, que necesitan niveles de permisos.
- Respuestas a un mensaje: cubierto con `{ replyTo }`, en el contract test de ambos adapters. Pendiente: hilos.
- Notificaciones: cubierto el evento `notification`, que sigue las reglas del homeserver y marca las menciones,
  validado contra Synapse en el smoke E2E. Pendiente: push del navegador y del sistema, que son de la aplicacion.

- Selector de conversaciones: cubierto con `conversations.open(userId)`, `findDirect(userId)` y `search(query)`.
  La lista llega ordenada por actividad reciente y cada conversacion trae `unreadCount`, validado contra Synapse
  en el smoke E2E.
- No crear rooms duplicados por accidente: cubierto. `open` reutiliza la conversacion directa (`isDirect`, marcada
  con `is_direct` y `m.direct` en Matrix), validado contra Synapse en el smoke E2E.
- Busqueda: cubierta la busqueda local de mensajes con `messages.search(query, { conversationId? })`. La busqueda
  remota no aplica a rooms cifrados y queda pendiente para rooms sin cifrar.
- Media: cubierto `messages.sendFile` con progreso, cifrado en rooms E2EE, paso por el outbox, miniaturas cifradas
  y `media.download`, validado contra Synapse en el smoke E2E. Pendiente: cache local de descargas.
- Rate limits y retry-after: los envios de eventos los reintenta el scheduler de `matrix-js-sdk`. El resto de
  llamadas (crear room, unirse, subir media) devuelven `SdkError` con codigo `RATE_LIMITED` y `retryAfterMs` para
  que la aplicacion decida. Pendiente: reintento automatico tambien en esas llamadas.
- Estados de carga y error: cubierto con `connection.changed`, `sync.changed`, estados de mensaje y `error`.
- API de paginacion: cubierta. `messages.loadMore` devuelve `{ messages, hasMore }`, validado contra Synapse en el
  smoke E2E. Al caer a la cache local `hasMore` es false, porque no hay mas que mostrar sin red.
- Electron: verificado en un renderer real con `examples/electron` (`npm run check --workspace=@relaykit/example-electron`),
  que comprueba login, room cifrado, adjuntos y storage IndexedDB cifrado. Esta en CI y cubre tambien el motor de
  navegador. Incluye la clave del storage en el llavero del sistema con `safeStorage` y un preload bridge, con
  la persistencia entre reinicios comprobada. Pendiente: empaquetar ese patron como `@relaykit/electron` si se
  quiere evitar que cada aplicacion lo reimplemente.

## Fase 7: framework y release

- Listas vivas en el nucleo (`createConversationList`, `createMessageTimeline`): quitan el pegamento que cada
  aplicacion reescribe y se conectan a cualquier framework. El ejemplo web las usa.
- Pendiente `@relaykit/react` y `@relaykit/vue`: con las listas vivas cada hook es una linea, asi que el paquete
  solo aporta comodidad. Hasta poder probar los hooks de verdad, se documenta el cableado en vez de publicarlos.

## Fase 7: calidad y release

Cubierto:

- Unit tests del core y del outbox con el adapter in-memory (`npm run test:unit`, en CI).
- Integration y E2E cifrados contra Synapse: chat con adjunto, recovery y verificacion SAS (en CI).
- CI reproducible con `npm ci`, typecheck, build, tests, `npm pack --dry-run` y smokes.
- `IndexedDbStorage` cubierto con `fake-indexeddb`: cifrado en reposo de mensajes y adjuntos, filtrado del outbox,
  purga y el cliente completo funcionando contra el storage real del navegador.
- Changelog y SemVer (`CHANGELOG.md`, version `0.1.0-alpha.1` en todos los paquetes).
- API review: superficie publica documentada en el README; `@relaykit/web` reexporta todos los tipos de core.
- Workflow de publicacion con npm provenance en `.github/workflows/release.yml`, disparado por tags `v*`.

Pendiente para publicar:

- Pasada manual en navegador siguiendo la checklist de `examples/web/README.md`. Es lo unico que no cubren los
  tests: interfaz real, IndexedDB del navegador y corte de red de verdad.

- Licencia decidida: Apache-2.0, con `LICENSE` y `NOTICE` en la raiz, copia en cada paquete y campo `license` en
  los cinco manifiestos.
- Inicializar el repositorio git, anadir `repository` en los `package.json`, crear el tag `v0.1.0-alpha.1` y
  configurar el secreto `NPM_TOKEN`.
- Contract tests compartidos: cubierto. `tests/adapter-contract.test.mjs` corre la misma suite contra in-memory y,
  con `npm run test:contract`, contra Matrix real. Esta en CI.
