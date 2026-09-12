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
- Crecimiento del storage: cubierto con un limite de mensajes cacheados por conversacion y otro de
  conversaciones (`cache.conversations`), que nunca descarta una con algo pendiente de enviar.
- Rendimiento local: el almacen esta indexado por conversacion y por estado, las escrituras van en una sola
  transaccion, la busqueda para en cuanto tiene bastante y la lista viva se actualiza en el sitio. Medido con
  `npm run bench:local`: con 150 conversaciones de 1.000 mensajes, abrir una conversacion cuesta 18 ms la
  primera vez y 11 ms las siguientes, y listar las conversaciones 6 ms. Esos numeros son contra una
  implementacion de IndexedDB en JavaScript, mucho mas lenta que la de un navegador: el ejemplo de Electron mide
  lo mismo contra Chromium real y abrir una conversacion con 1.300 mensajes guardados cuesta 1,4 ms. Enviar
  cuesta unos 30 ms, y eso es la ida y vuelta al homeserver, no trabajo local.
- Sala con mucha gente: medido de verdad con `npm run bench:big-room`, que da de alta doscientas cuentas y las
  mete en una sala. Con 291 conversaciones y una de 201 personas, listar las conversaciones cuesta 1,8 ms, asi
  que mapear no es el problema. Lo que cuesta es ponerse al dia al abrir la aplicacion, y ahi manda cuantos
  mensajes se piden por conversacion (`initialSyncLimit`, 20 por defecto):

  | mensajes por conversacion | ponerse al dia | datos |
  | --- | --- | --- |
  | 20 | 1167 ms | 2954 KB |
  | 5 | 797 ms | 1782 KB |
  | 1 | 730 ms | 1131 KB |

  Una aplicacion con muchas conversaciones deberia bajarlo. No se baja el valor por defecto porque con 1 solo se
  ve el ultimo mensaje de cada conversacion hasta que alguien pide mas.
- Soltar la conexion cuando la pestana deja de verse: probado y descartado. Un cliente no se puede levantar dos
  veces en la misma pagina. Con el mismo cliente, arrancar otra vez revienta la pagina; con uno nuevo, revienta
  igual si el almacen sigue abierto, y si se cierra el almacen la vuelta cuesta una sincronizacion entera. La
  unica forma que funciona es recargar la pagina, y eso ya cuesta 685 ms hasta pintar. Un navegador ademas ya
  frena por su cuenta lo que hace una pestana escondida.
- Apartar el cliente sin cerrarlo (una pausa que mantuviera el cifrado en pie): probado y descartado. La unica
  forma de parar la sincronizacion en `matrix-js-sdk` es `stopClient`, que ademas libera el motor de cifrado de
  Rust; despues de eso cualquier cosa que use cifrado revienta con "null pointer passed to rust". Cerrar y
  volver a abrir con `start({ waitForSync: false })` hace lo mismo y funciona: 1 ms hasta pintar.
- Carga perezosa de participantes en la sincronizacion (`lazyLoadMembers`): probada y descartada con numeros.
  Sobre la misma sala de 201 personas deja la lista de participantes en 21 y solo ahorra 131 KB de 2954, un 4%,
  sin ganar tiempo. Rompe algo que se usa (quien esta en un grupo, los permisos) a cambio de casi nada.
- Rotacion de la clave de cifrado del storage: cubierta. Los registros ilegibles se descartan al leerlos en vez
  de romper todas las lecturas, y `IndexedDbStorage.rekey` reescribe todo con el secreto nuevo para conservar la
  cache. Solo sirve teniendo el secreto anterior: si cambia el token y con el el secreto, no hay nada que
  reescribir y la cache se rellena desde el servidor.

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

- Comprobado que las claves creadas despues de activar la recuperacion si llegan al backup: el smoke de
  recuperacion abre una conversacion nueva despues de configurarla y el segundo dispositivo la lee. La version
  actual de `matrix-js-sdk` lo hace sola, asi que no hace falta empujar nada desde RelayKit. El contador de
  claves que devuelve el servidor va por detras y no sirve para comprobarlo: lo que se comprueba es que el
  dispositivo nuevo lo lee.
- Verificacion por codigo: cubierta y verificada entre dos dispositivos reales. El que muestra el codigo es el
  nuevo y el que lo lee es el que ya tiene las claves de firma cruzada, que es lo que hace que el codigo
  signifique algo. Verificar a otra persona sin indicar dispositivo tambien esta cubierto: ocurre dentro de la
  conversacion que comparten, verificado entre dos cuentas reales en `scripts/smoke-user-verification.mjs`.
- Eventos no descifrables: cubierto, llegan marcados con `undecryptable` y sin cuerpo.
- Cubierto: `conversations.rotateKeys` cambia la clave de una conversacion y `devices.revoke` deja de confiar en
  un dispositivo. Ambas verificadas contra Synapse en los smokes de chat y de verificacion.
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
- Federacion: cubierto con `scripts/smoke-federation.mjs` sobre dos homeservers que se hablan entre si, con
  invitacion, union y mensajes cifrados en ambos sentidos entre `@alice:fed1` y `@dave:fed2`. No hizo falta
  cambiar nada del SDK. Incluye unirse a una conversacion abierta que vive en el otro servidor pasando `via`.
- Caida real del homeserver: cubierto con `scripts/smoke-outage.mjs`, que para el contenedor, comprueba que el
  envio queda en cola, lo levanta y verifica que sale solo sin intervencion.
- Varios dispositivos del mismo usuario: cubierto con `scripts/smoke-devices.mjs`, que comprueba que se leen entre
  si en una sala cifrada y que el estado de lectura es de la persona, no del dispositivo.
- Distinguir quien ha aceptado de quien sigue invitado: cubierto con `Conversation.invitedIds`, en el contract
  test de ambos adapters.
- Grupos: cubierto con `scripts/smoke-group.mjs`, que comprueba que los tres se leen entre si en una sala cifrada,
  los no leidos y que el grupo encoge cuando alguien se va. Pendiente: grupos grandes y expulsar participantes.

Pendiente:

- Orden y deduplicacion de receipts y presence repetidos.
- Cubierto: typing, presence y recibos validados contra Synapse real en `scripts/smoke-live.mjs`, que fue lo que
  destapo que typing y recibos no llegaban nunca.

## Fase 6: API y UX

- Cuenta: cubierto el alta, el propio perfil y la gestion de sesiones abiertas.
- Moderacion: cubierto expulsar, vetar y levantar el veto, favoritos e ignorar personas, con permisos y roles.
- Hilos, espacios y busqueda en servidor: cubiertos, y los hilos y espacios verificados contra Synapse en el
  smoke de grupo.
- Texto con formato, menciones y mensajes de accion o aviso: cubiertos, en el contract test de ambos adapters y
  verificados cifrados contra Synapse en el smoke de chat.
- La conversacion por dentro: descripcion, imagen, silencio por persona y mensajes fijados, cubiertos y
  verificados cifrados contra Synapse en el smoke de chat. El silencio usa las mismas reglas de notificacion que
  el resto de clientes Matrix, asi que se respeta fuera de RelayKit.
- Donde se quedo cada persona: cubierto con el marcador de lectura y `messages.unreadSince`, en el contract test
  de ambos adapters contra Synapse real.
- Denunciar un mensaje: cubierto, en el contract test de ambos adapters.
- Lista publica y alias: cubiertos, en el contract test de ambos adapters. Publicar necesita que la conversacion
  se pueda abrir, y eso queda comprobado en el contrato.
- Sustituir una conversacion: cubierto con `upgrade` y `current`, verificado contra Synapse real.
- Palabras que interrumpen: cubierto con `push.watchFor`, en el contract test de ambos adapters.
- Reenviar mensajes: cubierto, incluidos los archivos cifrados, verificado contra Synapse en el smoke de chat.
- Notas de voz y sitios del mapa: cubiertos, en el contract test de ambos adapters y verificados cifrados
  contra Synapse en el smoke de chat.
- Quien entra y que se lee: cubiertos `setJoinRule`, `setHistoryVisibility`, `knock` y la lista de quien espera
  en la puerta, verificado entre tres cuentas en el smoke de grupo.
- Borradores: cubiertos, cifrados en IndexedDB, limpiados al enviar y borrados al cerrar sesion.
- Push: cubierto el registro de la pasarela en el homeserver, en el contract test de ambos adapters. Lo que
  queda del lado de la aplicacion es el service worker y el permiso del navegador, que no son del SDK.
- Fuera de alcance por ahora: llamadas de voz y video, widgets, servidores de identidad y la API de
  administracion. No son mensajeria.

- Perfiles: cubierto con `users.profile` y `users.avatar`, incluidos los nombres por conversacion, que en Matrix
  pueden diferir del perfil global. En el contract test de ambos adapters. Diciendo la conversacion se responden
  con lo ya sincronizado: medido con `npm run bench:round-trips`, pintar 432 nombres tres veces pasa de 432
  peticiones a ninguna.
- Gestion de conversaciones: cubierto invitar, renombrar y salir, en el contract test de ambos adapters.
  Pendiente: expulsar y bloquear, que necesitan niveles de permisos.
- Respuestas a un mensaje: cubierto con `{ replyTo }`, en el contract test de ambos adapters. Pendiente: hilos.
- Notificaciones: cubierto el evento `notification`, que sigue las reglas del homeserver y marca las menciones,
  validado contra Synapse en el smoke E2E. El registro de la pasarela de push esta cubierto con `client.push`;
  lo que queda (service worker y permiso del navegador) es de la aplicacion.

- Selector de conversaciones: cubierto con `conversations.open(userId)`, `findDirect(userId)` y `search(query)`.
  La lista llega ordenada por actividad reciente y cada conversacion trae `unreadCount`, validado contra Synapse
  en el smoke E2E.
- No crear rooms duplicados por accidente: cubierto. `open` reutiliza la conversacion directa (`isDirect`, marcada
  con `is_direct` y `m.direct` en Matrix), validado contra Synapse en el smoke E2E.
- Busqueda: cubierta la busqueda local de mensajes con `messages.search(query, { conversationId? })`. La busqueda
  remota no aplica a rooms cifrados y queda pendiente para rooms sin cifrar.
- Media: cubierto `messages.sendFile` con progreso, cifrado en rooms E2EE, paso por el outbox, miniaturas cifradas
  y `media.download`, validado contra Synapse en el smoke E2E. La cache de descargas esta cubierta, con limite
  en bytes y vaciado al cerrar sesion.
- Rate limits y retry-after: los envios de eventos los reintenta el scheduler de `matrix-js-sdk`. El resto de
  llamadas (crear room, unirse, subir media) devuelven `SdkError` con codigo `RATE_LIMITED` y `retryAfterMs` para
  que la aplicacion decida. Los envios de mensajes si se reintentan solos con esa espera.
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

- La pasada por el navegador ya no es manual: `npm run check:web-demo` sirve el ejemplo por http, lo abre en un
  Chromium de verdad, entra como alice, abre una conversacion, envia un mensaje y comprueba que aparece en
  pantalla sin quejas en la consola. Esta en CI. Servirlo por http y no abrirlo como fichero es necesario: el
  cifrado carga un modulo WebAssembly y un origen `file://` no puede.
- El corte de red tambien se comprueba solo: `check:web-demo` refusa todas las peticiones al homeserver, escribe
  un mensaje, comprueba que se queda esperando en pantalla, devuelve la red y comprueba que sale. Cortar de
  verdad no vale aqui: la emulacion de red de Electron deja pasar el trafico a localhost, asi que lo que se hace
  es rechazar las peticiones, que para la aplicacion es lo mismo.
- Cuentas con miles de conversaciones: cubierto con `conversationWindow`, que pide una ventana al homeserver en
  vez de todas las salas. Con 1245 conversaciones, ponerse al dia pasa de 14,8 s a 216 ms. Verificado contra
  Synapse en `scripts/smoke-window.mjs`. Usa sliding sync simplificado, que es lo que sirve Synapse.
- Sin homeserver se siguen leyendo las conversaciones, los mensajes, los hilos, los fijados, los borradores y
  los nombres. Lo que necesita preguntar si o si (quien ha leido que, los permisos, los espacios) dice que no
  puede en vez de inventarselo.
- Memoria en el navegador: medida dentro de `check:web-demo`. Abrir treinta conversaciones sube 4 MB y abrir
  noventa sube 0, que es lo que hacen unas caches con tope al llenarse y quedarse quietas.
- Ya no queda nada por probar a mano antes de publicar.

- Licencia decidida: Apache-2.0, con `LICENSE` y `NOTICE` en la raiz, copia en cada paquete y campo `license` en
  los cinco manifiestos.
- Inicializar el repositorio git, anadir `repository` en los `package.json`, crear el tag `v0.1.0-alpha.1` y
  configurar el secreto `NPM_TOKEN`.
- Contract tests compartidos: cubierto. `tests/adapter-contract.test.mjs` corre la misma suite contra in-memory y,
  con `npm run test:contract`, contra Matrix real. Esta en CI.
