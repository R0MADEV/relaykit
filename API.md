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

<!-- setup: declare const accessToken: string; declare const userId: string; -->

```ts
import { MessagingClient } from "@relaykit/web";

const client = new MessagingClient({
  session: { homeserver, userId, accessToken }
});
await client.start();
```

Tres datos opacos. No hace falta login con usuario y contraseña: si el token lo provisiona un backend, encaja.

### Empezar, parar y salir

| Qué | Qué hace |
|---|---|
| `client.start(opciones?)` | arranca. Con `waitForSync: false` vuelve enseguida y lo de ayer se pinta ya |
| `client.stop()` | para. La sesión sigue siendo válida: volver a arrancar no pide entrar otra vez |
| `client.logout()` | sale de verdad: se lo dice al homeserver, borra la copia local y suelta la credencial. Los tres pasos son independientes, así que ninguno se queda a medias porque otro falle |
| `client.currentSession()` | la sesión que tiene ahora mismo, o nada si no tiene ninguna |

`currentSession` hace pareja con el aviso `session.changed`: el aviso dice **cuándo**, esto dice **qué**. Una
pantalla dibujada después de que un token se renovara solo tiene dónde preguntar en lugar de adivinar.

### Cómo va la cosa

| Qué | Qué contesta |
|---|---|
| `client.getConnectionStatus()` | `"disconnected"`, `"connecting"`, `"connected"` o `"reconnecting"` |
| `client.getSyncStatus()` | `"idle"`, `"syncing"`, `"synced"` o `"error"` |

Los dos avisan también solos, con `connection.changed` y `sync.changed`. Se preguntan para pintar la primera
vez; después basta con escuchar.

`client.emitListenerError(error)` es la otra mitad de eso, y casi ninguna aplicación la llama: la usan las
listas vivas para decir que algo ha fallado **dentro de un suscriptor de la propia aplicación**. Sale por el
aviso `error`, como todo lo demás que va mal, en lugar de romper el trabajo que lo estaba haciendo.

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

## Todas las operaciones

Lo de arriba cuenta lo que hay que saber de las tres que más se usan. Esto es la lista entera, con lo que
recibe y devuelve cada una, escrita desde el código: `npm run check` falla si deja de coincidir.

<!-- generated: the operations -->

<!-- Escrito por `npm run write:api` desde `packages/core/src/client.ts`. No editar a mano. -->

Todo devuelve una promesa salvo donde se diga otra cosa.

### `client.conversations`

Las conversaciones: abrirlas, entrar, salir, y todo lo que se hace a una entera

```ts
list(options?: ListConversationsOptions): Promise<readonly Conversation[]>
create(input: CreateConversationInput): Promise<Conversation>
join(conversationId: ConversationId, options?: JoinConversationOptions): Promise<Conversation>
open(userId: string): Promise<Conversation>
leave(conversationId: ConversationId): Promise<void>
invite(conversationId: ConversationId, userId: string): Promise<Conversation>
rename(conversationId: ConversationId, title: string): Promise<Conversation>
remove(conversationId: ConversationId, userId: string, reason?: string): Promise<Conversation>
ban(conversationId: ConversationId, userId: string, reason?: string): Promise<Conversation>
unban(conversationId: ConversationId, userId: string): Promise<Conversation>
setUnread(conversationId: ConversationId, unread: boolean): Promise<Conversation>
setFavourite(conversationId: ConversationId, favourite: boolean): Promise<Conversation>
setTopic(conversationId: ConversationId, topic: string): Promise<Conversation>
setAvatar(conversationId: ConversationId, image: AvatarImage): Promise<Conversation>
setNotifications(conversationId: ConversationId, level: NotificationLevel): Promise<Conversation>
pin(conversationId: ConversationId, messageId: MessageId): Promise<void>
unpin(conversationId: ConversationId, messageId: MessageId): Promise<void>
rotateKeys(conversationId: ConversationId): Promise<void>
upgrade(conversationId: ConversationId): Promise<Conversation>
current(conversationId: ConversationId): Promise<Conversation>
link(conversationId: ConversationId): Promise<string>
setAlias(conversationId: ConversationId, alias: string): Promise<Conversation>
publish(conversationId: ConversationId, listed: boolean): Promise<void>
discover(query?: string): Promise<readonly PublicConversation[]>
setJoinRule(conversationId: ConversationId, rule: JoinRule): Promise<Conversation>
setHistoryVisibility( conversationId: ConversationId, visibility: HistoryVisibility ): Promise<Conversation>
knock(conversationId: ConversationId, options?: KnockOptions): Promise<void>
draft(conversationId: ConversationId): Promise<string | undefined>
pinned(conversationId: ConversationId): Promise<readonly Message[]>
participants(conversationId: ConversationId): Promise<readonly Participant[]>
permissions(conversationId: ConversationId): Promise<ConversationPermissions>
forget(conversationId: ConversationId): Promise<void>
tag(conversationId: ConversationId, tag: string): Promise<void>
untag(conversationId: ConversationId, tag: string): Promise<void>
tags(conversationId: ConversationId): Promise<readonly string[]>
versions(): Promise<RoomVersions>
setRole(conversationId: ConversationId, userId: string, role: ConversationRole): Promise<void>
findDirect(userId: string): Promise<Conversation | undefined>
search(query: string): Promise<readonly Conversation[]>
typing(conversationId: ConversationId, isTyping: boolean, timeoutMs = 5000): Promise<void>
```

### `client.messages`

Lo que se dice dentro de una conversación

```ts
list(id: ConversationId, options?: ListMessagesOptions): Promise<readonly Message[]>
loadMore(id: ConversationId, limit = 20): Promise<MessagePage>
search(query: string, options?: MessageSearchOptions): Promise<readonly Message[]>
thread(id: ConversationId, rootId: MessageId): Promise<readonly Message[]>
threads(id: ConversationId): Promise<readonly ThreadSummary[]>
searchRemote(query: string, options?: RemoteSearchOptions): Promise<RemoteSearchPage>
around(id: ConversationId, messageId: MessageId, limit?: number): Promise<MessageSurroundings>
send(id: ConversationId, body: string, options?: SendMessageOptions): Promise<Message>
sendFile(id: ConversationId, file: FileInput, options?: SendFileOptions): Promise<Message>
sendSticker(id: ConversationId, sticker: FileInput): Promise<Message>
sendLocation(id: ConversationId, location: GeoLocation): Promise<Message>
sendVoice(id: ConversationId, file: FileInput, voice: VoiceInfo): Promise<Message>
report(id: MessageId, reason: string): Promise<void>
unreadSince(id: ConversationId): Promise<readonly Message[]>
forward(id: MessageId, toConversationId: ConversationId): Promise<Message>
retry(id: MessageId): Promise<Message>
cancel(id: MessageId): Promise<Message>
markRead( conversationId: ConversationId, messageId: MessageId, options?: MarkReadOptions ): Promise<void>
readBy(conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]>
edit(id: ConversationId, messageId: MessageId, body: string): Promise<Message>
delete(id: ConversationId, messageId: MessageId): Promise<Message>
```

### `client.reactions`

Reaccionar a un mensaje

```ts
add(id: ConversationId, messageId: MessageId, key: string): Promise<Reaction>
remove(id: ConversationId, reactionId: string): Promise<void>
```

### `client.devices`

Las sesiones de esta cuenta, y cuáles son de fiar

```ts
verification(userId: string, deviceId: string): Promise<DeviceVerification | undefined>
verify(userId: string, deviceId: string): Promise<void>
revoke(userId: string, deviceId: string): Promise<void>
list(): Promise<readonly Device[]>
rename(deviceId: string, displayName: string): Promise<void>
signOut(deviceIds: readonly string[], options?: SignOutOptions): Promise<void>
```

### `client.push`

Avisos cuando la aplicación está cerrada

```ts
register(registration: PushRegistration): Promise<void>
registered(): Promise<readonly PushRegistration[]>
unregister(deviceToken: string): Promise<void>
watchFor(word: string): Promise<void>
stopWatchingFor(word: string): Promise<void>
keywords(): Promise<readonly string[]>
pending(options?: PendingNotificationsOptions): Promise<readonly Notification[]>
muted(): Promise<readonly string[]>
mute(userId: string): Promise<void>
unmute(userId: string): Promise<void>
level(): Promise<NotificationLevel>
setLevel(level: NotificationLevel): Promise<void>
```

### `client.crypto`

Las claves: protegerlas y recuperarlas

```ts
status(): Promise<CryptoStatus>
standing(): Promise<KeyStanding>
backupStatus(): Promise<KeyBackupStatus>
setupRecovery(options?: RecoverySetupOptions): Promise<RecoverySetup>
recover(recoveryKey: string): Promise<KeyBackupRestoreSummary>
```

### `client.account`

La cuenta: contraseña, direcciones, y darse de baja

```ts
changePassword(currentPassword: string, newPassword: string): Promise<void>
close(password: string): Promise<void>
remember(name: string, value: Readonly<Record<string, unknown>>): Promise<void>
remembered(name: string): Promise<Readonly<Record<string, unknown>> | undefined>
addresses(): Promise<readonly AccountAddress[]>
addEmail(email: string): Promise<AddressProof>
confirmEmail(proof: AddressProof, password: string): Promise<void>
removeAddress(kind: "email" | "phone", address: string): Promise<void>
```

### `client.sso`

Entrar con el sistema de identidad de la organización

```ts
waysIn(homeserver: string): Promise<readonly WayIn[]>
startAt(homeserver: string, comeBackTo: string, wayInId?: string): Promise<string>
finish(homeserver: string, token: string): Promise<Session>
```

### `client.presence`

Si alguien está delante de su pantalla

```ts
set(update: PresenceUpdate): Promise<void>
of(userId: string): Promise<UserPresence | undefined>
```

### `client.users`

Las personas: quién es quién, y a quién no quieres leer

```ts
profile(userId: string, conversationId?: ConversationId): Promise<User>
avatar(userId: string, options?: AvatarOptions): Promise<AvatarImage | undefined>
search(query: string, options?: SearchUsersOptions): Promise<readonly User[]>
setDisplayName(displayName: string): Promise<void>
setAvatar(image: AvatarImage): Promise<void>
ignored(): Promise<readonly string[]>
ignore(userId: string): Promise<void>
unignore(userId: string): Promise<void>
```

### `client.spaces`

Agrupar conversaciones

```ts
list(): Promise<readonly Space[]>
create(input: CreateSpaceInput): Promise<Space>
add(spaceId: ConversationId, conversationId: ConversationId): Promise<void>
remove(spaceId: ConversationId, conversationId: ConversationId): Promise<void>
conversations(spaceId: ConversationId): Promise<readonly Conversation[]>
children(spaceId: ConversationId): Promise<readonly SpaceChild[]>
```

### `client.location`

Compartir dónde estás, mientras te mueves

```ts
start(conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation>
update(sharingId: string, position: GeoLocation): Promise<void>
stop(sharingId: string): Promise<void>
list(conversationId: ConversationId): Promise<readonly LiveLocation[]>
```

### `client.calls`

Llamadas y videollamadas

```ts
place(conversationId: ConversationId, options?: PlaceCallOptions): Promise<Call>
join(conversationId: ConversationId, options?: PlaceCallOptions): Promise<Call>
answer(callId: string, options?: PlaceCallOptions): Promise<Call>
hangUp(callId: string): Promise<void>
reject(callId: string): Promise<void>
muteMicrophone(callId: string, muted: boolean): Promise<void>
muteCamera(callId: string, muted: boolean): Promise<void>
shareScreen(callId: string, sharing: boolean): Promise<void>
quality(callId: string): Promise<CallQuality>
useMicrophone(deviceId: string): Promise<void>
useCamera(deviceId: string): Promise<void>
list(): Promise<readonly Call[]>
history(conversationId: ConversationId, limit?: number): Promise<readonly PastCall[]>
```

### `client.polls`

Preguntar algo y contar las respuestas

```ts
start(conversationId: ConversationId, input: StartPollInput): Promise<Poll>
vote(conversationId: ConversationId, pollId: MessageId, answerId: string): Promise<void>
close(conversationId: ConversationId, pollId: MessageId): Promise<void>
list(conversationId: ConversationId): Promise<readonly Poll[]>
```

### `client.media`

Archivos: bajarlos, y qué acepta el servidor

```ts
download(media: MediaRef): Promise<Uint8Array<ArrayBuffer>>
preview(url: string): Promise<LinkPreview>
limits(): Promise<MediaLimits>
```

### `client.verification`

Comprobar que otra sesión o persona es quien dice

```ts
request( userId: string, deviceId?: string, options?: VerificationRequestOptions ): Promise<VerificationSession>
qrCode(sessionId: string): Promise<Uint8Array | undefined>
scan(sessionId: string, code: Uint8Array): Promise<VerificationSession>
accept(sessionId: string): Promise<VerificationSession>
cancel(sessionId: string): Promise<VerificationSession>
confirm(sessionId: string): Promise<VerificationSession>
reject(sessionId: string): Promise<VerificationSession>
```

### En el propio cliente

```ts
client.login(credentials: LoginCredentials): Promise<Session>
client.resetPassword(homeserver: string, email: string): Promise<AddressProof>
client.finishResettingPassword(homeserver: string, proof: AddressProof, newPassword: string): Promise<void>
client.currentSession(): Session | undefined
client.signInAsGuest(homeserver: string): Promise<Session>
client.register(credentials: RegisterCredentials): Promise<Session>
client.start(options?: StartOptions): Promise<void>
client.stop(): Promise<void>
client.logout(): Promise<void>
client.getConnectionStatus(): ConnectionStatus
client.getSyncStatus(): SyncStatus
client.emitListenerError(error: unknown): void
```

<!-- end generated -->

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

```text
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

```text
id  title?  participantIds  invitedIds?  knockingIds?  membership?
lastMessage?  unreadCount  isDirect?  joinRule?  historyVisibility?
alias?  replacedBy?  replaces?
```

`participantIds` **incluye** a los invitados; `invitedIds` es el subconjunto que aún no ha aceptado.

### `Participant`

```text
userId  role  membership  isUnderMe
```

`role` es `"member" | "moderator" | "admin"`. `membership`, dónde está: `"join"`, `"invite"`, `"knock"`,
`"leave"` o `"ban"`. `isUnderMe` es si quien preguntó lo supera, y es lo único que debería decidir qué botones
se dibujan.

### `PastCall`

```text
id  conversationId  startedAt  endedAt  participantIds
```

`participantIds` es todo el que estuvo en algún momento, en el orden en que llegó. **Uno solo significa que
nadie más entró.**

### `Call`

```text
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

<!-- setup: declare const video: HTMLVideoElement; -->

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
