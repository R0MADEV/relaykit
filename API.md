# Lo que la biblioteca te da

Para quien construye la interfaz. Qué se pide, qué vuelve y qué avisa sola.

Para las piezas de debajo (Synapse, coturn, el SDK), ver [PIEZAS.md](PIEZAS.md).

---

## Lo primero: nada de esto es de Matrix

Una aplicación que use RelayKit **no ve** `room_id`, `event_id`, tokens de sincronización ni eventos de Matrix.
Ve `Conversation`, `Message`, `User`, `Call`. Eso no es una intención, es medible:

```
ficheros de @relaykit/core que importan matrix-js-sdk: 0
dependencias de @relaykit/core: ninguna
```

Por eso los mismos tests de contrato corren contra el adaptador de Matrix y contra uno en memoria: si el núcleo
supiera algo de Matrix, el de memoria no podría pasarlos.

## Arrancar

```ts
import { MessagingClient } from "@relaykit/web";

const client = new MessagingClient({
  session: { homeserver, userId, accessToken }
});
await client.start();
```

Tres datos opacos. No hace falta login con usuario y contraseña: si el token lo provisiona un backend, encaja.

---

## Lo que se pide

Todo devuelve una promesa. Si una operación **vuelve**, lo que hizo ya se puede leer — es una regla del
contrato, no una casualidad, y varios fallos han salido de ahí.

### `client.conversations`

```
list          create        open          join          leave         invite
rename        remove        ban           unban         setRole       permissions
setTopic      setAvatar     setAlias      publish       discover      knock
setJoinRule   setHistoryVisibility        setUnread     setFavourite
setNotifications            pin           unpin         pinned
draft         typing        search        findDirect    current
rotateKeys    upgrade
```

`open(userId)` abre la conversación de dos con esa persona, creándola si no la hay. `create` es para las de
varios.

### `client.messages`

```
list          loadMore      send          sendFile      sendVoice     sendSticker
sendLocation  edit          delete        forward       report
thread        threads       search        searchRemote
markRead      readBy        unreadSince   retry         cancel
```

`list` devuelve `Message[]`; `loadMore` sigue hacia atrás y devuelve una `MessagePage`, que además dice si
queda más. Enviar funciona sin conexión: el mensaje se guarda y sale solo cuando vuelve la red.

### `client.calls`

```
place         join          answer        hangUp        reject
muteMicrophone              muteCamera    hold          shareScreen
transfer      useMicrophone useCamera     list
```

**Rechazar no es colgar**: al otro lado se le dice otra cosa. **Poner en espera no es silenciar**: en espera al
otro se le avisa y deja de oír y de ver.

**`place` suena; `join` no.** Una llamada directa se marca y alguien la contesta. Una **conferencia** ya está
en marcha en una conversación y se entra en ella con `join(conversationId)`: nadie descuelga, y sigue sin ti
cuando cuelgas. Una llamada de dos personas es una conferencia con dos dentro, así que es el mismo `Call`
y no hay otro sitio donde mirar. Lo que no tiene sentido en una sala — espera, transferencia, teclas — se
rechaza con `NOT_SUPPORTED`. El audio y el vídeo de una conferencia los lleva un servidor que **no puede
leerlos**: las claves viajan por Matrix y cada frame sale cifrado del navegador.

La lista de micrófonos y cámaras **no la da la biblioteca**: la da el navegador con `enumerateDevices()`.
`useMicrophone(deviceId)` es la parte que sí es nuestra.

### Los demás

| Grupo | Qué hay |
|---|---|
| `client.reactions` | `add`, `remove` |
| `client.polls` | `start`, `vote`, `close`, `list` |
| `client.location` | `start`, `update`, `stop`, `list` — ubicación en vivo |
| `client.media` | `download`, `preview` (previsualización de enlaces), `limits` (lo que el servidor acepta) |
| `client.presence` | `profile`, `avatar`, `search`, `setDisplayName`, `setAvatar`, `ignore`, `unignore`, `ignored` |
| `client.devices` | `list`, `rename`, `verify`, `revoke`, `signOut`, `verification` |
| `client.verification` | `request`, `qrCode`, `scan`, `accept`, `confirm`, `reject`, `cancel` |
| `client.crypto` | `status`, `backupStatus`, `setupRecovery`, `recover` |
| `client.push` | `register`, `unregister`, `keywords`, `watchFor`, `mute`, `level`, `pending` |
| `client.spaces` | `list`, `create`, `add`, `remove`, `conversations` |

---

## Lo que avisa solo

```ts
const stop = client.on("message.received", message => { /* … */ });
```

Devuelve la función para dejar de escuchar.

| Evento | Cuándo |
|---|---|
| `message.received` | Llega un mensaje |
| `message.updated` | Se edita, se borra, o cambia su estado de envío |
| `conversation.updated` | Cambia el nombre, el último mensaje, lo no leído… |
| `reaction.added` / `reaction.removed` | Alguien reacciona |
| `receipt.received` | Alguien lee |
| `typing.changed` | Alguien escribe |
| `presence.changed` | Alguien se conecta o se va |
| `notification` | Algo que merece avisar |
| `call.incoming` | **Te llaman**, o una conferencia empieza en una conversación tuya. Aquí es donde una pantalla suena |
| `call.changed` | La llamada avanza, alguien entra o sale, se silencia, se pone en espera o acaba |
| `call.speaking` | Quién está hablando ahora. Aparte a propósito: cambia varias veces por segundo y solo ilumina un borde |
| `verification.requested` / `verification.changed` | Verificación de dispositivos |
| `connection.changed` / `sync.changed` | Estado de la conexión |
| `session.ended` | El homeserver dejó de aceptar la sesión. Nadie lo pidió desde aquí |
| `error` | Algo falló y no había a quién devolvérselo |

---

## Lo que vuelve

### `Message`

```ts
id  conversationId  senderId  body  createdAt  status
editedAt?  deletedAt?  replyToId?  threadId?  attachment?  location?
formattedBody?  mentions?  kind?  undecryptable?
```

`undecryptable` es el caso honesto: el mensaje llegó cifrado y este dispositivo no tiene la clave. El cuerpo
está vacío y la interfaz debería decirlo, no fingir.

### `Conversation`

```ts
id  title?  participantIds  invitedIds?  knockingIds?  membership?
lastMessage?  unreadCount  isDirect?  joinRule?  historyVisibility?
alias?  replacedBy?  replaces?
```

`participantIds` **incluye** a los invitados; `invitedIds` es el subconjunto que aún no ha aceptado.

### `Call`

```ts
id  conversationId  callerId  isVideo  state  startedAt  kind  isEncrypted?
participants  ownMedia?  remoteMedia?  hasRemoteMedia?
isMicrophoneMuted  isCameraMuted  isOnHold  isSharingScreen
```

`kind` es `"direct"` o `"conference"`. `participants` es **todo el mundo, tú incluido**, cada uno con su
`media` y su `screen` para pintar una caja por persona; en una llamada directa `remoteMedia` es el atajo para
la única otra caja. `isEncrypted` es lo que dibuja el candado, y falta mientras no se sabe (antes de entrar).

`state` es `"ringing" | "connecting" | "connected" | "ended"`. No son los estados internos del SDK: son los
cuatro que una pantalla dibuja distinto.

`ownMedia` y `remoteMedia` son **`MediaStream` del navegador**, listos para un elemento:

```ts
client.on("call.changed", call => {
  video.srcObject = call.remoteMedia ?? null;
});
```

Se entregan en vez de describirse porque una pantalla no puede reproducir un booleano.

---

## Lo que hay que saber para no tropezar

**Las llamadas necesitan navegador.** El SDK se niega a crear una sin `RTCPeerConnection`, y hace bien. En Node
no se pueden probar; por eso el contrato las exige al doble y las salta donde WebRTC no puede existir.

**El audio y la imagen llegan cuando llegan**, no cuando la llamada cambia de estado. En vídeo, casi siempre
después de estar conectada. Escucha `call.changed` y vuelve a asignar `srcObject`.

**Silenciar y la espera no cambian el estado** de la llamada, pero sí la llamada: también llegan por
`call.changed`.

**Silenciar el micro y apagar la cámara no son lo mismo por debajo.** Silenciar apaga la pista y volver a
hablar la enciende. Apagar la cámara **detiene y quita** la pista, así que encenderla obliga a acordar una
nueva con el otro lado. En nuestras comprobaciones eso **no llega a completarse**: la cámara no vuelve y la
llamada sigue solo con sonido. No está establecido si es la cámara sintética de las pruebas o pasa igual con
una de verdad. Si tu interfaz ofrece encender la cámara, **pruébalo con una cámara real antes de fiarte**.

Lo mismo pasa con des-silenciar dentro de una **videollamada**: ahí el SDK también va a pedir el micrófono de
nuevo, y vuelve a ser un acuerdo nuevo. En una llamada de voz silenciar y volver a hablar funciona y está
comprobado en las dos direcciones.

**La copia local es una comodidad, no la verdad.** Si el almacén falla, se informa y se sigue.

**Hace falta origen seguro.** Sin `https` no hay `crypto.subtle`, y sin eso no hay copia local cifrada.

**Detener el cliente no se deshace.** Al parar, el SDK libera la máquina de cifrado. Para reanudar tras una
suspensión, recarga: destruir y volver a nacer es el camino probado, y lo que quedara por enviar no se pierde
porque vive en la copia local.
