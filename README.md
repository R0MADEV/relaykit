# RelayKit

SDK de mensajería headless para aplicaciones web y Electron, construido sobre el ecosistema Matrix.

RelayKit proporciona a una aplicación una API pequeña y estable para incorporar chat sin exponer conceptos de
Matrix como `room_id`, `event_id`, tokens de sincronización o eventos Matrix.

> Estado: **0.1.0-alpha.1**. La API publica puede cambiar entre versiones menores hasta 1.0.0. Ver `CHANGELOG.md`.

## Instalacion

```bash
npm install @relaykit/web
```

`@relaykit/web` incluye el cliente, el adapter Matrix y el storage IndexedDB cifrado. Para Node o para adapters
propios, usar `@relaykit/core` directamente.

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
await client.messages.retry(messageId);
await client.messages.cancel(messageId);

const sent = await client.messages.sendFile(
  conversationId,
  { name: "photo.jpg", mimeType: "image/jpeg", data: bytes, width: 800, height: 600 },
  { onProgress: fraction => console.log(fraction) }
);
const content = await client.media.download(sent.attachment);

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

const timeline = createMessageTimeline(client, conversationId);
await timeline.refresh();
```

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

## Adjuntos

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
| `ADAPTER_ERROR`   | el homeserver o la red fallaron                                        |

```ts
try {
  await client.conversations.create({ participantIds: [userId] });
} catch (error) {
  if (error.code === "RATE_LIMITED") await wait(error.retryAfterMs ?? 1000);
}
```

Los envios de mensajes no necesitan este manejo: el outbox los reintenta solo. Cuando la conexion vuelve se
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

## Alcance

RelayKit se encarga de la experiencia de mensajería del cliente:

- restauración de sesión
- sincronización y reconexión
- conversaciones y timelines
- local echo y outbox
- persistencia local
- eventos tipados
- multimedia
- integración con E2EE de Matrix

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
