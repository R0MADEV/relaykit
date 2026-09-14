# RelayKit

SDK de mensajería headless para aplicaciones web y Electron, construido sobre el ecosistema Matrix.

RelayKit proporciona a una aplicación una API pequeña y estable para incorporar chat sin exponer conceptos de
Matrix como `room_id`, `event_id`, tokens de sincronización o eventos Matrix.

- [API.md](API.md) — lo que la biblioteca da a quien construye la interfaz.
- [PIEZAS.md](PIEZAS.md) — qué usa por debajo y qué hace cada cosa.

> Estado: **0.1.0-alpha.1**. La API publica puede cambiar entre versiones menores hasta 1.0.0. Ver `CHANGELOG.md`.

## Instalacion

```bash
npm install @relaykit/web
```

`@relaykit/web` incluye el cliente, el adapter Matrix y el storage IndexedDB cifrado. Para Node o para adapters
propios, usar `@relaykit/core` directamente.

## Todo lo que hay

| Área | Qué se puede hacer |
|---|---|
| **Sesión** | entrar, registrarse, salir, restaurar la sesión de la última vez, sincronizar y reconectar |
| **Conversaciones** | crear, entrar, salir, invitar, llamar a la puerta, buscar, abrir la de dos con alguien, el enlace que cualquier cliente entiende |
| **Ajustes de conversación** | nombre, tema, imagen, alias público, publicar en el directorio, quién puede entrar, cuánto historial ve quien llega, favorita, silenciada, marcarla sin leer, actualizarla de versión |
| **Moderación** | quién está y qué es cada uno, qué puedes hacer tú, dar y quitar moderador, expulsar, vetar, readmitir |
| **Mensajes** | enviar, editar, borrar, responder, hilos, formato, menciones, reenviar, reportar, fijar, reintentar, descartar |
| **Contenido** | ficheros, imágenes, vídeo, audio, notas de voz, stickers, ubicación y ubicación en vivo |
| **Medios** | subir, descargar, miniaturas, adjuntos cifrados, previsualización de enlaces, lo que el servidor acepta |
| **Reacciones** | poner, quitar — y **las que ya están vienen en el mensaje** |
| **Lectura** | recibos, hasta dónde ha leído cada uno, contadores, lo que llegó desde la última vez |
| **Borradores** | lo que estabas escribiendo, guardado en el servidor |
| **Presencia** | escribiendo, y en línea / ausente / desconectado — **leer y escribir** |
| **Gente** | perfiles, avatares, buscar en el directorio, tu nombre y tu foto, ignorar |
| **Llamadas** | de dos o de muchas, vídeo, compartir pantalla, silenciar, calidad, elegir micrófono y cámara, **y las que ya terminaron** |
| **Cifrado** | extremo a extremo, verificación de dispositivos por emojis, firma cruzada, copia de claves, recuperación, rotación, **y en qué estado está este dispositivo** |
| **Dispositivos** | tus sesiones, renombrarlas, cerrarlas |
| **Notificaciones** | push, reglas, palabras clave, silenciar a alguien, nivel por sala y por cuenta, lo que está esperando |
| **Encuestas** | preguntar, votar, cerrar |
| **Espacios** | agrupar conversaciones |
| **Búsqueda** | local y en el servidor |
| **Listas vivas** | la lista de conversaciones y el timeline de una, al día solos, **y el timeline va hacia atrás** |

[API.md](API.md) tiene el detalle: cada llamada, cada evento y cada forma que devuelve.

### Lo que Matrix tiene y esto todavía no

Dicho para que nadie lo descubra a mitad de una integración:

- **Formas de entrar**: SSO/OIDC, invitados, correo y teléfono. Solo hay usuario y contraseña.
- **Gestión de cuenta**: cambiar contraseña, dar de baja.
- **Etiquetas propias** y datos de cuenta arbitrarios. Favorita sí; `m.tag` no.
- **`forget`**: salir de una sala *y* borrarla de tu historial.
- **Jerarquía de espacios**: los espacios listan hijos, pero no hay árbol ni orden.
- **Widgets** y **llamadas 1-a-1 clásicas** (`m.call.*`). Aquí las llamadas van por MatrixRTC.
- **QR de verificación**: solo emojis.

La API de administración de Synapse no está **ni debería**: administrar un servidor no es cosa de un cliente.

## Objetivo

```text
Aplicación
    |
    v
RelayKit
    |
    v
matrix-js-sdk
    |
    v
Homeserver Matrix
```

Funciona en navegador y en Electron: `examples/electron` lo comprueba de forma automatica en un renderer real.
La primera implementación está orientada a Web y Electron con TypeScript. Rust y `matrix-rust-sdk` serán adaptadores
futuros, no dependencias del MVP.

## Ejemplo

```ts
const client = new MessagingClient({
  session: {
    homeserver: "https://matrix.example.com",
    userId: "@user:example.com",
    accessToken: "access-token",
    deviceId: "DEVICE"
  }
});

await client.start();

// Ordenadas por actividad reciente, con `unreadCount` y `lastMessage` para pintar la lista.
// `invitedIds` dice quien sigue sin aceptar, para poder marcarlo en la interfaz.
const conversations = await client.conversations.list();
const messages = await client.messages.list(conversationId);

// Historial hacia atras. `hasMore` es false cuando se alcanza el inicio de la conversacion.
const { messages: timeline, hasMore } = await client.messages.loadMore(conversationId, 20);

await client.messages.send(conversationId, "Hola");

await client.messages.edit(conversationId, messageId, "Hola de nuevo");
await client.messages.delete(conversationId, messageId);

const conversation = await client.conversations.create({
  participantIds: ["@other:example.com"],
  title: "Soporte",
  encrypted: true
});

// Una conversacion abierta, a la que se entra sin invitacion. Desde otro servidor hace falta decir donde vive.
const comunidad = await client.conversations.create({ participantIds: [], title: "Comunidad", public: true });
await client.conversations.join(comunidad.id, { via: ["otro.servidor"] });

await client.conversations.invite(conversationId, "@carol:example.com");
await client.conversations.rename(conversationId, "Soporte nivel 2");
await client.conversations.leave(conversationId);

// Conversacion directa: reutiliza la existente en vez de crear un room duplicado.
const direct = await client.conversations.open("@other:example.com");
const existing = await client.conversations.findDirect("@other:example.com");

// Busqueda local, sin enviar nada al servidor.
const matches = await client.conversations.search("soporte");
const found = await client.messages.search("presupuesto", { conversationId: direct.id });

await client.messages.send(conversationId, "me viene bien", { replyTo: messageId });
const readers = await client.messages.readBy(conversationId, messageId);
await client.messages.forward(messageId, otraConversationId);
await client.messages.report(messageId, "acoso");

// Donde se quedo esta persona, que es donde va la linea de "mensajes nuevos".
await client.messages.markRead(conversationId, messageId);
const nuevos = await client.messages.unreadSince(conversationId);

// Un hilo ya abierto se sigue leyendo sin red, igual que la conversacion.
const respuestas = await client.messages.thread(conversationId, messageId);
await client.messages.retry(messageId);
await client.messages.cancel(messageId);

const sent = await client.messages.sendFile(
  conversationId,
  { name: "photo.jpg", mimeType: "image/jpeg", data: bytes, width: 800, height: 600 },
  { onProgress: fraction => console.log(fraction) }
);
const content = await client.media.download(sent.attachment);

// Texto con formato, menciones y mensajes que no son una frase normal.
await client.messages.send(conversationId, "esto es importante", {
  formattedBody: "<strong>esto es importante</strong>",
  mentions: { userIds: ["@carol:example.com"] }
});
await client.messages.send(conversationId, "todos", { mentions: { everyone: true } });
await client.messages.send(conversationId, "saluda", { kind: "action" });
await client.messages.send(conversationId, "el servidor se reinicia", { kind: "notice" });

// Una nota de voz y un sitio del mapa, que llegan como lo que son y no como un archivo o una linea de texto.
await client.messages.sendVoice(
  conversationId,
  { name: "nota.ogg", mimeType: "audio/ogg", data: bytes },
  { durationMs: 3200, waveform: [0, 512, 1024, 256] }
);
await client.messages.sendLocation(conversationId, { latitude: 43.263, longitude: -2.935, description: "Bilbao" });

// `formattedBody` es HTML escrito por otra persona. RelayKit lo entrega tal cual y no lo sanea:
// pasalo por un saneador antes de meterlo en el DOM, o pinta `body`, que siempre es texto plano.

const unsubscribe = client.on("message.received", message => {
  console.log(message);
});
```

## Listas vivas

Escuchar eventos y mantener a mano una lista al dia es el pegamento que toda aplicacion acaba reescribiendo:
reconciliar el eco local de cada mensaje, ordenar, recargar tras cada cambio. Viene resuelto:

```ts
import { createConversationList, createMessageTimeline } from "@relaykit/web";

const conversations = createConversationList(client);
await conversations.refresh();
const unsubscribe = conversations.subscribe(() => pintar(conversations.get()));

// `atLeast` dice con cuanto abrir. Lo que el sync haya traido no es un numero que nadie eligiera.
const timeline = createMessageTimeline(client, conversationId, { atLeast: 30 });
await timeline.refresh();

// Y va hacia atras. Devuelve si queda mas, y nunca quita de la pantalla lo que ya estaba.
const hayMas = await timeline.loadMore();
```

Lo que cuelga de un hilo **no entra en el timeline**, ni al listarlo ni segun llega: un hilo se lee con
`client.messages.thread(id, rootId)`.

`get()` devuelve la misma referencia mientras el contenido no cambia, asi que sirve tal cual para React:

```ts
const conversations = useSyncExternalStore(list.subscribe, list.get);
```

Al terminar, `stop()` deja de seguir al cliente.

## Eventos

Todos los eventos se suscriben con `client.on(nombre, listener)` y devuelven una funcion para desuscribirse.

| Evento                 | Payload         | Cuando se emite                                              |
| ---------------------- | --------------- | ------------------------------------------------------------ |
| `connection.changed`   | `ConnectionStatus` | cambia el estado de conexion                              |
| `sync.changed`         | `SyncStatus`    | cambia el estado de sincronizacion                           |
| `conversation.updated` | `Conversation`  | se crea o cambia una conversacion                            |
| `message.received`     | `Message`       | llega un mensaje nuevo                                       |
| `message.updated`      | `Message`       | cambia el estado de envio, o se edita o elimina un mensaje, local o remoto |
| `reaction.added`       | `Reaction`      | se añade una reaccion                                        |
| `reaction.removed`     | `Reaction`      | se elimina una reaccion                                      |
| `typing.changed`       | `TypingUpdate`  | cambia la lista de usuarios escribiendo en una conversacion  |
| `receipt.received`     | `ReadReceipt`   | un usuario marca un mensaje como leido                       |
| `presence.changed`     | `UserPresence`  | cambia la presencia de un usuario                            |
| `notification`         | `Notification`  | llega un mensaje que merece avisar al usuario                |
| `error`                | `Error`         | un error asincrono que no pertenece a ninguna llamada        |

Las ediciones y eliminaciones remotas se persisten en el storage antes de emitirse.

En una conversacion cifrada, un mensaje solo lo pueden leer quienes el emisor sabia que estaban dentro al
enviarlo. Si alguien acaba de entrar y tu cliente todavia no lo ha visto, ese mensaje no le llegara legible. No es
algo que el SDK pueda evitar: la clave se reparte en el momento del envio. En la practica basta con esperar al
`conversation.updated` que anuncia al nuevo participante.

Un mensaje que llega cifrado y este dispositivo no puede leer, porque las claves son de otra sesion, llega con
`undecryptable` a true y el cuerpo vacio. La aplicacion decide como representarlo; lo que nunca vera es el texto
interno que pone `matrix-js-sdk` en su lugar.

El SDK decide **que** merece un aviso, siguiendo las reglas de notificacion del homeserver, y la aplicacion decide
**como** mostrarlo. Nunca avisa de los mensajes propios:

```ts
client.on("notification", ({ senderId, body, isMention }) => {
  new Notification(isMention ? `${senderId} te menciona` : senderId, { body });
});
```

Un mensaje propio se emite primero con un identificador local (`local-...`) y despues, ya enviado, con el
identificador del servidor. Para pintarlo una sola vez, indexar por `transactionId ?? id`:

```ts
const key = message.transactionId ?? message.id;
```

## Reacciones

```ts
await client.reactions.add(conversationId, messageId, "👍");
await client.reactions.remove(conversationId, reactionId);
```

Las que **ya estan puestas** vienen con el mensaje, en `message.reactions`, mas antiguas primero. No se piden
una por linea: viajan en el mismo timeline, asi que una pantalla que abre una conversacion ya las tiene. Lo
que llega despues son `reaction.added` y `reaction.removed`.

## Adjuntos

El outbox necesita `storage` para sobrevivir a un reinicio. Sin el, un envio pendiente solo se observa por
eventos y desaparece al cerrar. `@relaykit/web` lo configura solo en el navegador.

`messages.sendFile` sube el archivo y envia el mensaje con `attachment` a traves del outbox, asi que un envio fallido
se reintenta o se cancela como un mensaje de texto y sobrevive a un reinicio. En rooms cifrados el contenido se cifra
antes de subirlo. `attachment.source` es un localizador opaco: nunca es una URL publica y solo sirve para
`media.download`, que descarga y descifra el contenido.

Para no descargar una foto entera solo para enseñarla en la lista, el emisor puede adjuntar una miniatura. La hace
la aplicacion, que es la unica que sabe dibujar sus propios archivos, y se cifra igual que el original:

```ts
await client.messages.sendFile(conversationId, { name, mimeType, data, thumbnail });
const preview = message.attachment.thumbnail;
if (preview) image.src = URL.createObjectURL(new Blob([await client.media.download(preview)], { type: preview.mimeType }));
```

## En que estado estan las claves de este dispositivo

```ts
const estado = await client.crypto.standing();
// "ready"            — todo montado y este dispositivo tiene la clave
// "locked"           — hay algo en el servidor en lo que no ha entrado: una clave, u otra sesion, lo abre
// "never-protected"  — esta cuenta nunca protegio sus claves
```

Tres respuestas porque hay **tres cosas distintas que ofrecer**, y confundirlas sale caro: ofrecerle crear una
clave de recuperacion a quien ya tiene una **reemplaza la copia de la que dependen sus otros dispositivos**.
Se decide una vez aqui, no en cada pantalla.

## Recuperacion E2EE

La primera vez, el dispositivo crea cross-signing, secret storage y key backup. La recovery key se muestra una sola vez
y no se persiste:

```ts
const { recoveryKey } = await client.crypto.setupRecovery({ password });
```

En un dispositivo nuevo, la misma clave restaura las claves de cifrado desde el backup:

```ts
const { total, imported } = await client.crypto.recover(recoveryKey);
```

Conviene activar la recuperacion al iniciar sesion, antes de enviar. `matrix-js-sdk` sube las claves al backup
en una sola pasada al activarlo, con un retardo aleatorio de hasta diez segundos, y un envio posterior no lanza
otra. Una clave creada justo despues puede tardar en llegar al backup hasta el siguiente arranque de la
aplicacion.

`logout()` borra el storage local. `stop()` lo conserva para reanudar la sesion.

## Si alguien esta o no

```ts
await client.presence.set({ presence: "online" });      // lo que haces tu
const suyo = await client.presence.of(userId);          // lo que hace otro
client.on("presence.changed", ({ userId, presence }) => { /* lo que cambia mientras miras */ });
```

Leerlo hace falta porque `presence.changed` solo cuenta **lo que cambio mientras estabas mirando**, y lo que
no cambio antes de eso sigue siendo verdad: una pantalla llena de caras tiene que poder preguntar.

## Perfiles

Para no enseñar identificadores crudos en la interfaz:

```ts
const { displayName, avatarId } = await client.users.profile(userId);
const avatar = await client.users.avatar(userId);
if (avatar) image.src = URL.createObjectURL(new Blob([avatar.data], { type: avatar.mimeType }));
```

`avatarId` es opaco y cambia cuando cambia la imagen, asi que sirve como clave de cache. Un usuario sin perfil
devuelve solo su `id`, sin error.

## Errores

Los fallos previsibles llegan como `SdkError` con un `code` estable, nunca como errores de Matrix. Los que una
aplicacion necesita distinguir:

| `code`            | Significado                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `INVALID_INPUT`   | los datos de la llamada no son validos                                 |
| `INVALID_SESSION` | la sesion caduco o fue revocada: hay que volver a iniciar sesion        |
| `RATE_LIMITED`    | el homeserver esta limitando al cliente; `retryAfterMs` dice cuanto esperar |
| `NOT_STARTED`     | se uso el cliente antes de `start()`                                    |
| `ADAPTER_ERROR`   | el homeserver o la red fallaron; el mensaje trae el motivo del servidor |

```ts
try {
  await client.conversations.create({ participantIds: [userId] });
} catch (error) {
  if (error.code === "RATE_LIMITED") await wait(error.retryAfterMs ?? 1000);
}
```

Los envios de mensajes no necesitan este manejo: el outbox los reintenta solo. Si el homeserver responde que vas
demasiado rapido, el mensaje se reenvia solo pasada exactamente la espera que pide, sin que la aplicacion tenga que
hacer nada. Cuando la conexion vuelve se
reintenta todo lo que quedo pendiente, sin esperar al backoff, porque recuperar la red es justamente la senal de
que el fallo anterior ya no aplica. Un mensaje que agota sus ocho intentos deja de reintentarse solo y queda a la
espera de `messages.retry` o `messages.cancel`.

## Storage local

El storage del navegador es una cache y no crece sin fin: al listar una conversacion se descartan los mensajes
entregados mas antiguos y se conservan los 500 mas recientes. `messages.loadMore` los vuelve a traer si el usuario
sube en el historial. Lo que sigue en la cola de envio nunca se descarta, porque solo existe en local.

```ts
const client = new MessagingClient({ cache: { messagesPerConversation: 2000 } });
```

La fuente de verdad es el homeserver. Se cifra con una clave derivada de
`storageSecret`, que por defecto es el access token. Si ese secreto cambia, los registros escritos con el anterior
dejan de ser legibles: se descartan al leerlos, sin romper la aplicacion, y la cache se rellena desde el servidor.
Para no perder la cache en cada rotacion de token, pasar un secreto estable por dispositivo.

## Verificacion de dispositivos

Un dispositivo nuevo pide verificacion a los dispositivos ya verificados del mismo usuario. El otro dispositivo
recibe `verification.requested`, acepta, y ambos reciben la fase `sas` con los emoji a comparar:

```ts
const requested = await client.verification.request(userId);

client.on("verification.requested", session => client.verification.accept(session.id));
client.on("verification.changed", session => {
  if (session.phase === "sas") showEmoji(session.sas.emoji);
});

await client.verification.confirm(sessionId); // los emoji coinciden
await client.verification.reject(sessionId);  // no coinciden
await client.verification.cancel(sessionId);
```

Para verificar el dispositivo de otro usuario hay que indicar su `deviceId` en `request`.

## Cuenta

```ts
// Crear una cuenta, donde el homeserver lo permita solo con usuario y contrasena.
const session = await client.register({ homeserver, username, password });

// El propio perfil.
await client.users.setDisplayName("Alicia");
await client.users.setAvatar({ mimeType: "image/png", data });

// Donde esta abierta la sesion, y cerrarla en otro sitio.
const devices = await client.devices.list();
await client.devices.rename(deviceId, "Portatil del trabajo");
await client.devices.signOut([deviceId], { password });

// Dejar de leer a alguien.
await client.users.ignore("@ruidoso:example.com");
```

Si el homeserver pide algo mas que una contrasena para crear cuentas, por ejemplo un captcha o aceptar terminos,
`register` falla con `REGISTRATION_UNSUPPORTED` y el mensaje dice exactamente que pasos exige.

## Hilos

Una respuesta puede colgar de un mensaje en vez de llenar la conversacion:

```ts
const raiz = await client.messages.send(conversationId, "¿Quien despliega?");
await client.messages.send(conversationId, "Yo", { threadId: raiz.id });
const hilo = await client.messages.thread(conversationId, raiz.id);
```

Lo que cuelga de un hilo no aparece en `messages.list`, que es la conversacion principal.

## Espacios

Agrupan conversaciones por equipo o por proyecto. Un espacio no es una conversacion y nunca se lista como tal:

```ts
const espacio = await client.spaces.create({ title: "Irontec" });
await client.spaces.add(espacio.id, conversationId);
const dentro = await client.spaces.conversations(espacio.id);
```

## Busqueda

`messages.search` mira lo que este dispositivo ya tiene, y funciona con conversaciones cifradas.
`messages.searchRemote` pregunta al homeserver, que es mas rapido con mucho historial pero no puede leer lo
cifrado, asi que ahi no encuentra nada.

## La conversacion por dentro

De que va, que cara tiene, cuanto interrumpe y que hay que tener siempre a mano:

```ts
await client.conversations.setTopic(conversationId, "Incidencias de produccion");
await client.conversations.setAvatar(conversationId, { data: bytes, mimeType: "image/png" });

// "all" suena siempre, "mentions" solo cuando te nombran, "none" no suena nunca.
await client.conversations.setNotifications(conversationId, "mentions");

await client.conversations.pin(conversationId, messageId);
const fijados = await client.conversations.pinned(conversationId);
// La conversacion tambien dice cuales son, en `pinnedIds`, y se siguen leyendo sin red.
await client.conversations.unpin(conversationId, messageId);
```

El silencio es una decision de cada persona, no de la sala: viaja en las reglas de notificacion de la cuenta,
asi que se respeta en todos sus dispositivos y tambien en Element o cualquier otro cliente Matrix.

## Quien entra y que se lee

```ts
// "invite" solo para invitados, "public" para cualquiera, "knock" para quien llame a la puerta.
await client.conversations.setJoinRule(conversationId, "knock");

// Hasta donde puede leer quien llega tarde: "world", "shared", "invited" o "joined".
await client.conversations.setHistoryVisibility(conversationId, "joined");

// Desde fuera: pedir entrar, y desde dentro ver quien espera y dejarle pasar.
await client.conversations.knock(conversationId, { reason: "trabajo aqui", via: ["otro.servidor"] });
const { knockingIds } = (await client.conversations.list()).find(item => item.id === conversationId);
await client.conversations.invite(conversationId, knockingIds[0]);
```

## Abrir la aplicacion

```ts
// Vuelve en cuanto el cliente esta en marcha: lo de ayer se pinta al momento.
await client.start({ waitForSync: false });
const deAyer = await client.conversations.list();

// Y cuando el servidor contesta, se vuelve a pintar con lo que diga.
client.on("sync.changed", status => { if (status === "synced") repintar(); });
```

Con 354 conversaciones eso son 0,7 ms en vez de 1829. Arrancar sin decir nada sigue esperando al servidor.

## Cuando la aplicacion sale de pantalla

```ts
await client.stop();
// ...y al volver
await client.start({ waitForSync: false });
```

Cerrarla suelta la conexion, y abrirla pinta lo que ya habia al momento: verificado contra un homeserver real,
1 ms hasta pintar, y lo que paso mientras tanto se recupera solo. En un navegador, lo natural es hacerlo cuando
la pestana deja de verse.

## Nombres

```ts
// Diciendo en que conversacion, el nombre sale de lo ya sincronizado y no cuesta ninguna peticion.
const aqui = await client.users.profile(userId, conversationId);
const imagen = await client.users.avatar(userId, conversationId);

// Sin decirlo, es el nombre que usa en todas partes, y eso si hay que preguntarlo.
const enTodasPartes = await client.users.profile(userId);
```

Pintar una lista de conversaciones diciendo cual es cada una cuesta cero peticiones. Sin decirlo, una por
persona. Cambiar el propio nombre olvida lo recordado al momento, para que no se siga mostrando el anterior. Las fotos
guardadas tienen tope en bytes, configurable con `cache.avatarBytes`.

## Cuentas con muchas conversaciones

Lo que de verdad cuesta al arrancar no es pintar la lista, que son milisegundos, sino que el homeserver mande
todas tus salas. Para eso esta la ventana:

```ts
const client = new MessagingClient({ matrix: { conversationWindow: 40 } });
await client.start();

const primeras = await client.conversations.list({ limit: 40 });
const masAbajo = await client.conversations.list({ limit: 80 }); // ensancha la ventana
```

Medido con 1245 conversaciones: ponerse al dia pasa de 14,8 segundos a 0,2. Va apagada por defecto.

### Si prefieres no usar la ventana

Ponerse al dia al arrancar crece con el numero de conversaciones, y lo que mas pesa es cuantos mensajes se piden
de cada una. Medido con 1245 conversaciones:

| mensajes por conversacion | ponerse al dia |
| --- | --- |
| 20 por defecto | 14,8 s |
| 5 | 8,1 s |
| 1 | 3,6 s |

La otra palanca, para cuentas de verdad grandes, es pedirle al homeserver una ventana en vez de todas las
salas. Con 1245 conversaciones, ponerse al dia pasa de 14,8 s a 216 ms:

```ts
const client = new MessagingClient({ matrix: { conversationWindow: 40 } });
// Pedir mas conversaciones ensancha la ventana.
const masAbajo = await client.conversations.list({ limit: 80 });
```

```ts
// Pedir poco al arrancar...
const client = new MessagingClient({ matrix: { initialSyncLimit: 1 } });
await client.start({ waitForSync: false });

// ...pintar solo las primeras conversaciones y pedir mas al hacer scroll...
const primeras = await client.conversations.list({ limit: 40 });
const masAbajo = await client.conversations.list({ limit: 80 });

// ...y pedir lo que haga falta al abrir una conversacion.
const mensajes = await client.messages.list(conversationId, { atLeast: 30 });
```

Con eso la primera pantalla sale al momento desde lo guardado y ninguna conversacion se abre vacia.

## Buscar

```ts
// Para en cuanto tiene bastante, empezando por lo mas reciente.
const encontrados = await client.messages.search("despliegue", { limit: 20 });
const aqui = await client.messages.search("despliegue", { conversationId });
```

Buscar en local significa descifrar lo que hay guardado, asi que el limite no es cosmetico: es lo que separa
responder al momento de masticar todo el historial. Por defecto son cincuenta.

## Escribiendo

```ts
// Se puede llamar en cada tecla: solo sale una peticion, y se renueva antes de que caduque.
await client.conversations.typing(conversationId, true);
await client.conversations.typing(conversationId, false);
```

Lo mismo con `messages.markRead`: repetir el mismo mensaje no vuelve a salir a la red, y sin conexion se
recuerda hasta donde leiste para contarlo cuando vuelva. Una reaccion, una correccion o un borrado sin conexion
se comportan igual: se recuerdan y se hacen al volver, mientras la pantalla ya muestra lo que sera.

## Verificar un dispositivo

```ts
// Comparando emoji, que es lo que hace cualquier dispositivo.
const sesion = await client.verification.request(userId, deviceId);
// Sin decir el dispositivo se verifica a la persona, dentro de la conversacion que comparten.
const aOtraPersona = await client.verification.request(userId);
// ...cuando llega la fase "sas", comparar sesion.sas.emoji y confirmar.
await client.verification.confirm(sesion.id);

// O con un codigo: el dispositivo nuevo lo muestra y el de confianza lo lee.
const nueva = await client.verification.request(userId, undefined, { method: "code" });
const codigo = await client.verification.qrCode(nueva.id);
await client.verification.scan(otraSesionId, codigo);
await client.verification.confirm(nueva.id);
```

## Cambiar la clave de una conversacion

```ts
await client.conversations.rotateKeys(conversationId);
await client.devices.revoke(userId, deviceId);
```

Lo que se diga a partir de ahi va con una clave nueva. Quien conserve la vieja se queda con lo dicho antes y
nada mas, que es justo lo que hace falta cuando alguien deja el equipo.

## Cambiar el secreto del almacen local

```ts
const storage = new IndexedDbStorage("relaykit", { encryptionSecret: viejo });
await storage.rekey(nuevo);
```

Reescribe todo con el secreto nuevo en vez de dejarlo ilegible. Hay que tener el anterior: si lo que cambia es
el token y con el el secreto, no queda nada que reescribir y la cache se rellena desde el servidor.

## Como se llama cada quien

```ts
const global = await client.users.profile(userId);

// En un grupo alguien puede ir por otro nombre, y ese es el que hay que mostrar ahi.
const aqui = await client.users.profile(userId, conversationId);
```

## Cuando una conversacion se sustituye por otra

```ts
const nueva = await client.conversations.upgrade(conversationId);

// Sigue la cadena hasta la conversacion en la que esta la gente ahora mismo.
const actual = await client.conversations.current(conversationId);
```

## Encontrar una conversacion publica

```ts
await client.conversations.setAlias(conversationId, "#soporte:example.com");
await client.conversations.publish(conversationId, true);

const publicas = await client.conversations.discover("soporte");
await client.conversations.join(publicas[0].id, { via: ["example.com"] });
```

Una conversacion a la que solo se entra por invitacion no aparece en la lista aunque se publique: la lista
estaria apuntando a una puerta cerrada. Hay que abrirla antes con `setJoinRule`.

## Lo que estabas escribiendo

Un borrador es texto privado de esa persona: se guarda en local, cifrado igual que los mensajes, sobrevive a
cerrar la aplicacion, desaparece al enviar el mensaje y se borra al cerrar sesion.

```ts
await client.conversations.saveDraft(conversationId, "estaba escribiendo esto");
const pendiente = await client.conversations.draft(conversationId);
```

## Avisar con la aplicacion cerrada

El homeserver no habla con el navegador ni con el movil: le entrega el aviso a una pasarela de push, que es
quien conoce el dispositivo. Solo viaja el identificador del evento, asi que lo que se dice no pasa por ella.

```ts
await client.push.register({
  gatewayUrl: "https://push.example.com/_matrix/push/v1/notify",
  deviceToken: subscription.endpoint,
  appId: "com.example.chat.web",
  appName: "Ejemplo",
  deviceName: "Portatil",
  data: { public_key: claveWebPush, auth_secret: secreto }
});
const registrados = await client.push.registered();

// Palabras por las que merece la pena interrumpir, igual que cuando te nombran.
await client.push.watchFor("despliegue");
const palabras = await client.push.keywords();
await client.push.stopWatchingFor("despliegue");
await client.push.unregister(subscription.endpoint);
```

## Moderacion

```ts
await client.conversations.remove(conversationId, userId, "motivo");
await client.conversations.ban(conversationId, userId, "motivo");
await client.conversations.unban(conversationId, userId);
await client.conversations.setFavourite(conversationId, true);

// Que puede hacer esta persona aqui, para no ofrecer botones que van a fallar.
const { canRemove, canRename } = await client.conversations.permissions(conversationId);
await client.conversations.setRole(conversationId, userId, "moderator");

// Y quien esta, y que es cada uno.
for (const quien of await client.conversations.participants(conversationId)) {
  quien.role;        // "member" | "moderator" | "admin"
  quien.membership;  // "join" | "invite" | "knock" | "leave" | "ban"
  quien.isUnderMe;   // si le superas, que es lo unico que decide si hay boton
}
```

`isUnderMe` lo decide el adaptador, no la pantalla: nadie puede expulsar, vetar ni recolocar a quien esta a
su altura o por encima —ni a si mismo— y saber eso es saber de niveles de poder. Quien esta vetado **sigue en
la lista**, porque readmitirlo solo lo puede ofrecer una lista que lo tenga.

## Autenticacion

Tambien se puede iniciar sesion desde el cliente y cerrar la sesion cuando sea necesario:

```ts
const client = new MessagingClient({});

const session = await client.login({
  homeserver: "https://matrix.example.com",
  username: "user",
  password: "password",
  deviceName: "Web"
});

await client.start();
await client.logout();
```

## Llamadas y videoconferencia

```ts
const call = await client.calls.place(conversationId, { video: true });  // suena al otro lado
const room = await client.calls.join(conversationId);                     // entra en la conferencia de la conversación
client.on("call.incoming", call => { /* te llaman, o una conferencia ha empezado */ });
client.on("call.changed", call => { /* call.participants: una caja por persona, cada una con su media */ });
client.on("call.speaking", ({ userIds }) => { /* a quién iluminar */ });
await client.calls.hangUp(call.id);
```

Una llamada es una sala, tenga dos personas o diez: la lleva un SFU (LiveKit) al que Matrix sigue mandando —
quién puede entrar, quién está dentro y las claves con las que cada navegador cifra lo que manda, de modo que
el servidor reparte lo que no puede leer. Para probarlo en local, [infrastructure/livekit](./infrastructure/livekit/README.md).

## Las llamadas que ya terminaron

```ts
for (const llamada of await client.calls.history(conversationId, 20)) {
  llamada.startedAt;       // cuando empezo
  llamada.endedAt;         // y cuando se quedo vacia
  llamada.participantIds;  // todo el que estuvo, en el orden en que llego
}
```

Se lee **de la propia conversacion**, no de lo que recordara quien estaba mirando: entrar en una llamada se
escribe en la sala y salir lo borra, y ambas cosas quedan. Asi la misma historia se ve desde cualquier
dispositivo, incluso uno que estaba apagado mientras ocurria. Una llamada con **un solo nombre** es una sala
en la que nadie llego a entrar.

## Invitaciones que viajan como mensaje

```ts
const enlace = await client.conversations.link(conversationId);
await client.messages.send(otraConversacion, enlace);
```

Al otro lado llega un mensaje con `invitesTo` puesto. Se lee **del enlace**, no de una forma inventada aqui,
asi que una invitacion escrita por cualquier otro cliente tambien se entiende — y lo que la pantalla haga con
eso, una tarjeta con una puerta en vez de una linea de texto, es cosa suya.

## Escribir un adaptador propio

Un backend que no sea Matrix implementa **diecisiete metodos**: entrar, registrarse, arrancar, parar, salir;
listar, crear, entrar, salir e invitar en conversaciones; listar mensajes, traer mas y enviar; y quien es
alguien. Eso es lo que la mensajeria *es*.

Todo lo demas son **dieciocho capacidades opcionales** que se declaran por separado y se pueden dejar fuera
enteras: `moderation`, `conversationSettings`, `threads`, `pins`, `receipts`, `search`, `presence`,
`editing`, `ignoring`, `calling`, `polls`, `location`, `spaces`, `media`, `push`, `devices`, `reactions`,
`crypto`.

Un adaptador que no las trae no falla al arrancar: la biblioteca responde `NOT_SUPPORTED` a quien lo pida, en
un solo sitio. Decirlo **no estando** es mejor que una docena de metodos que existen para negarse.

## Alcance

RelayKit se encarga de la experiencia de mensajería del cliente:

- restauración de sesión
- sincronización y reconexión
- conversaciones y timelines
- local echo y outbox
- persistencia local
- eventos tipados
- multimedia
- llamadas y videoconferencias cifradas, de dos personas o de muchas, y las que ya terminaron
- moderación: quién está, qué es cada uno y qué puedes hacerle
- integración con E2EE de Matrix, y en qué estado están las claves de este dispositivo

En el navegador, `@relaykit/web` configura IndexedDB automáticamente cuando existe una sesión identificada. Los cuerpos
de mensajes del store propio se cifran con AES-GCM usando la sesión como secreto. Los stores de RelayKit y Matrix
utilizan bases de datos separadas; el store criptográfico de Matrix queda aislado por usuario y dispositivo. La
aplicación puede proporcionar un
adaptador de almacenamiento propio si necesita otra estrategia de persistencia o si autentica después de crear el
cliente.

Las operaciones de envío utilizan local echo y estados de entrega. Un mensaje fallido queda disponible para reintento
mediante `client.messages.retry(messageId)`.

El backend de la aplicación consumidora se encarga del provisioning de usuarios, la autorización empresarial y las
operaciones administrativas de Matrix. Las credenciales administrativas nunca llegan al navegador.

## Arquitectura

Consulta [ARCHITECTURE.md](./ARCHITECTURE.md) y [PLAN.md](./PLAN.md).

Para probar el SDK contra un homeserver real local, consulta [infrastructure/matrix/README.md](./infrastructure/matrix/README.md).

## Licencia

Apache-2.0. Ver `LICENSE`. Se eligio esta y no MIT por la concesion expresa de patentes, y porque es la misma
licencia de `matrix-js-sdk`, sobre el que RelayKit esta construido.

## Nombre

`relaykit` es el nombre provisional del proyecto y de los paquetes. La disponibilidad de nombres como `@relaykit/web`
debe comprobarse antes de publicar.
