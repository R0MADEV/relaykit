# Lo que la biblioteca te da

Para quien construye la interfaz. Qué se pide, qué vuelve y qué avisa sola.

Para las piezas de debajo (Synapse, LiveKit, el SDK), ver [PIEZAS.md](PIEZAS.md).

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
current       findDirect    search        link          typing
saveDraft     draft         pin           unpin         pinned

participants  permissions   setRole       remove        ban           unban        knock

rename        setTopic      setAvatar     setAlias      publish       discover
setJoinRule   setHistoryVisibility        setUnread     setFavourite
setNotifications            rotateKeys    upgrade

forget        tag           untag         tags          versions
```

`open(userId)` abre la conversación de dos con esa persona, creándola si no la hay. `create` es para las de
varios. `link(id)` da el enlace `matrix.to` que cualquier otro cliente entiende, y que al mandarlo como
mensaje llega al otro lado como una invitación.

`participants(id)` dice **quién está y qué es cada uno**: su rango, dónde está (dentro, invitado, esperando,
fuera, vetado) y si quien pregunta lo supera. Ese último lo decide el adaptador, porque nadie puede expulsar,
vetar ni recolocar a quien está a su altura o por encima — y un botón que siempre falla es peor que ninguno.
Quien está vetado sigue en la lista, porque readmitirlo solo lo puede ofrecer una lista que lo tenga.

`leave(id)` deja de recibirla; `forget(id)` la borra además de tu historial. Son dos pasos y en ese orden:
olvidar una conversación en la que sigues la devuelve en la siguiente sincronización.

`tag(id, "trabajo")` la archiva bajo un nombre tuyo, que nadie más ve. Favorita y prioridad baja no salen en
`tags(id)`: son del protocolo y se preguntan por su lado (`setFavourite`, `setNotifications`).

`versions()` dice qué versiones de sala admite el homeserver y cuál prefiere, que es entre lo que puede
elegir un `upgrade`.

### `client.messages`

```
list          loadMore      send          sendFile      sendVoice     sendSticker
sendLocation  edit          delete        forward       report
thread        threads       search        searchRemote  around
markRead      readBy        unreadSince   retry         cancel
```

`around(id, mensajeId, cuantos)` abre la conversación **donde se dijo algo** en vez de en su final: el mensaje
y lo que se dijo a cada lado. Es lo que le falta a un resultado de búsqueda, porque una línea suelta dice
quién la dijo y casi nunca de qué iba.

`searchRemote(consulta, { limit, cursor })` devuelve `{ messages, cursor }`. El cursor lo pone el homeserver;
una búsqueda que ya lo dio todo no trae ninguno.

`list` devuelve `Message[]`; `loadMore` sigue hacia atrás y devuelve una `MessagePage`, que además dice si
queda más. `list(id, { atLeast })` pide **cuánto abrir**: lo que el sync haya traído no es un número que
nadie eligiera, y una conversación con historia que el homeserver todavía no ha mandado se pide en vez de
leerse como vacía.

Enviar funciona sin conexión: el mensaje se guarda y sale solo cuando vuelve la red.

`threads(id)` da un resumen por hilo — cuántas respuestas cuelgan y cuáles no has leído — sin abrir ninguno.
Lo que cuelga de un hilo **no aparece en la conversación**, ni al listar ni al llegar.

### `client.calls`

```
place         join          answer        hangUp        reject
muteMicrophone              muteCamera    shareScreen
useMicrophone useCamera     quality       list          history
```

**Una llamada es una sala, tenga dos personas o diez.** `place` te mete en ella el primero y hace sonar a los
demás; `join` entra en una que ya está en marcha sin hacer sonar a nadie; `answer` es entrar en la que te
sonó. **Colgar es salir**: la llamada sigue para quien quede. **Rechazar no es colgar**: la llamada sigue sin
ti y simplemente dejas de oír hablar de ella.

El audio y el vídeo los lleva un servidor (LiveKit) que **no puede leerlos**: las claves viajan por Matrix y
cada frame sale cifrado del navegador. Matrix sigue mandando: quién puede estar, quién está, y las claves.

`history(id)` da las llamadas **que ya terminaron**, leídas de la propia conversación y no recordadas por
quien estaba mirando: entrar en una llamada se escribe en la sala y salir lo borra, y ambas cosas quedan. Así
la misma historia se ve desde cualquier dispositivo, incluso uno que estaba apagado mientras ocurría. Una
llamada con un solo nombre es una sala en la que nadie llegó a entrar.

No hay espera, ni transferencia, ni teclas: eso es vocabulario de teléfono, y el teléfono no va por aquí.

**Una pantalla compartida a la vez, y la última gana.** Si alguien empieza a compartir mientras tú compartes,
tú dejas de hacerlo y te enteras por `call.changed` (`isSharingScreen` pasa a `false`). Nadie puede parar la
pantalla de otro; quien se aparta es el que ya estaba, y sale lo mismo para todos sin que nadie mande.

La lista de micrófonos y cámaras **no la da la biblioteca**: la da el navegador con `enumerateDevices()`.
`useMicrophone(deviceId)` es la parte que sí es nuestra.

### Los demás

| Grupo | Qué hay |
|---|---|
| `client.reactions` | `add`, `remove` — las que ya están llegan **en el mensaje**, en `message.reactions` |
| `client.polls` | `start`, `vote`, `close`, `list` |
| `client.location` | `start`, `update`, `stop`, `list` — ubicación en vivo |
| `client.media` | `download`, `preview` (previsualización de enlaces), `limits` (lo que el servidor acepta) |
| `client.users` | `profile`, `avatar`, `search`, `setDisplayName`, `setAvatar`, `ignore`, `unignore`, `ignored` |
| `client.presence` | `set` (lo que haces tú), `of(userId)` (lo que hace otro) |
| `client.sso` | `waysIn`, `startAt`, `finish` — entrar con el SSO de la organización, Google, GitHub |
| `client.signInAsGuest(homeserver)` | entrar sin cuenta, donde el homeserver lo permita |
| `client.devices` | `list` (la sesión que usas primero, luego por cuándo se vio cada una), `rename`, `verify`, `revoke`, `signOut`, `verification` |
| `client.verification` | `request`, `qrCode`, `scan`, `accept`, `confirm`, `reject`, `cancel` |
| `client.crypto` | `standing`, `status`, `backupStatus`, `setupRecovery`, `recover` |
| `client.push` | `register`, `registered`, `unregister`, `watchFor`, `stopWatchingFor`, `keywords`, `pending`, `mute`, `unmute`, `muted`, `level`, `setLevel` |
| `client.spaces` | `list`, `create`, `add`, `remove`, `conversations`, `children` (el árbol entero, con `depth`) |
| `client.account` | `changePassword`, `close` (darse de baja), `remember(nombre, valor)`, `remembered(nombre)`, `addresses`, `addEmail`, `confirmEmail`, `removeAddress` |
| `client.resetPassword(servidor, correo)` | volver a entrar cuando no te acuerdas; se termina con `finishResettingPassword` |

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
| `call.changed` | La llamada avanza, alguien entra o sale, se silencia, comparte pantalla o acaba |
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
formattedBody?  mentions?  kind?  undecryptable?  reactions?  invitesTo?
```

`undecryptable` es el caso honesto: el mensaje llegó cifrado y este dispositivo no tiene la clave. El cuerpo
está vacío y la interfaz debería decirlo, no fingir.

`reactions` son las que ya están puestas, más antiguas primero. **Vienen con el mensaje**, no se piden una por
línea: viajan en el mismo timeline, así que una pantalla que abre una conversación ya las tiene. Lo que llega
después son `reaction.added` y `reaction.removed`.

`invitesTo` está cuando el mensaje lleva un enlace a una conversación. Se lee **del enlace**, no de una forma
inventada aquí, así que una invitación escrita por cualquier otro cliente también se entiende. Qué hace una
pantalla con eso —una tarjeta con una puerta, en vez de una línea de texto— es cosa suya.

### `Conversation`

```ts
id  title?  participantIds  invitedIds?  knockingIds?  membership?
lastMessage?  unreadCount  isDirect?  joinRule?  historyVisibility?
alias?  replacedBy?  replaces?
```

`participantIds` **incluye** a los invitados; `invitedIds` es el subconjunto que aún no ha aceptado.

### `Participant`

```ts
userId  role  membership  isUnderMe
```

`role` es `"member" | "moderator" | "admin"`. `membership`, dónde está: `"join"`, `"invite"`, `"knock"`,
`"leave"` o `"ban"`. `isUnderMe` es si quien preguntó lo supera, y es lo único que debería decidir qué botones
se dibujan.

### `PastCall`

```ts
id  conversationId  startedAt  endedAt  participantIds
```

`participantIds` es todo el que estuvo en algún momento, en el orden en que llegó. **Uno solo significa que
nadie más entró.**

### `Call`

```ts
id  conversationId  callerId  isVideo  state  startedAt  isEncrypted?  wentWrong?
participants  ownMedia?  ownScreen?  remoteMedia?  remoteScreen?
isMicrophoneMuted  isCameraMuted  isSharingScreen
```

`participants` es **todo el mundo, tú incluido**, cada uno con su `media` y su `screen` para pintar una caja
por persona. `remoteMedia` y `remoteScreen` son el atajo para cuando hay exactamente otra persona, que es lo
que son casi todas las llamadas. `isEncrypted` es lo que dibuja el candado, y falta mientras no se sabe (antes
de entrar). `callerId` es quien la empezó.

`state` es `"ringing" | "connected" | "ended"`. `ringing` es una llamada en marcha en una conversación tuya
en la que aún no estás; `connected`, que estás en ella — solo, si acabas de empezarla; `ended`, que se acabó
para ti.

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

**Silenciar, apagar la cámara y compartir pantalla no cambian el estado** de la llamada, pero sí la llamada:
también llegan por `call.changed`.

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
