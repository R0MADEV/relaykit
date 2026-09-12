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
- Un mensaje rechazado por ir demasiado rapido se reenvia solo pasada la espera que indica el homeserver, en vez
  de quedarse esperando a la siguiente reconexion.
- Al recuperar la conexion se reenvia todo lo que quedo en la cola, sin esperar al backoff. Lo que agoto sus
  intentos sigue esperando una decision explicita.
- La cache local deja de crecer sin limite: conserva los 500 ultimos mensajes entregados por conversacion,
  configurable con `cache.messagesPerConversation`, y nunca descarta lo que sigue en la cola de envio.
- Los participantes de una conversacion ya no incluyen a quien la abandono o fue expulsado.
- Hilos: `messages.send(..., { threadId })` y `messages.thread`, con lo que cuelga de un hilo fuera de la
  conversacion principal.
- Espacios para agrupar conversaciones: `spaces.create`, `add`, `remove`, `conversations` y `list`.
- Permisos y roles: `conversations.permissions` responde que puede hacer la persona, y `conversations.setRole`
  nombra moderadores.
- Busqueda en el servidor con `messages.searchRemote`, complementaria a la local para conversaciones sin cifrar.
- Alta de cuentas con `register`, que resuelve el caso de usuario y contrasena y explica que pide el homeserver
  cuando necesita mas.
- El propio perfil se puede cambiar: `users.setDisplayName` y `users.setAvatar`.
- Sesiones abiertas: `devices.list`, `devices.rename` y `devices.signOut`.
- Moderacion: `conversations.remove`, `ban` y `unban`, y `setFavourite` para marcar una conversacion.
- Personas ignoradas con `users.ignore`, `unignore` e `ignored`.
- El evento `message.received` se emite de verdad. Estaba declarado y documentado, pero todo llegaba como
  `message.updated`, asi que una aplicacion que solo escuchara la llegada no veia ningun mensaje.
- Conversaciones abiertas con `create({ public: true })` y `join(id, { via })` para entrar en una que vive en otro
  servidor, que era justo lo que fallaba con "no servers that are in the room have been provided".
- Verificada la federacion entre dos homeservers: invitacion, union y mensajes cifrados en ambos sentidos.
- Un mensaje que el homeserver todavia no ha aceptado ya no aparece como enviado en el timeline. Su estado lo
  lleva el outbox, que es quien sabe si sigue de camino.
- `Conversation.invitedIds` dice quien ha sido invitado y todavia no ha aceptado, que antes no se podia distinguir.
- `conversations.join` ya no responde hasta que la conversacion se puede usar. Antes se podia volver de unirse y
  fallar el primer envio porque el estado de la sala aun no habia llegado.
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
- Texto con formato (`formattedBody`), menciones (`mentions.userIds`, `mentions.everyone`) y mensajes que no son
  una frase normal (`kind: "action"` y `kind: "notice"`), tanto al enviarlos como al leerlos.
- La conversacion por dentro: `conversations.setTopic`, `setAvatar` y `setNotifications` con los tres niveles
  "all", "mentions" y "none". El silencio viaja en las reglas de notificacion de la cuenta, asi que se respeta en
  todos los dispositivos de esa persona y tambien en cualquier otro cliente Matrix.
- Mensajes fijados: `conversations.pin`, `unpin` y `pinned`, que devuelve los mensajes descifrados y no una lista
  de identificadores.
- Los avisos de que alguien esta escribiendo y los recibos de lectura llegaban vacios contra un homeserver real:
  el evento efimero no trae identificador de sala y RelayKit lo leia de ahi, asi que los descartaba todos. Ahora
  la sala viene de quien recibe el aviso. Los tests unitarios no lo veian porque construian el evento con la sala
  dentro; lo destapo el nuevo smoke de eventos en vivo contra Synapse.
### Rendimiento

- El nombre y la imagen de alguien dentro de una conversacion se sacan de lo que ya esta sincronizado, sin
  preguntar al servidor. Medido con 301 conversaciones y 432 personas: pintar todos los nombres tres veces pasa
  de 432 peticiones a **ninguna**. Solo se pregunta por quien la conversacion no describe.
- `users.avatar` acepta tambien la conversacion, por lo mismo, y la imagen se guarda igual que el nombre: una
  lista que se repinta ya no vuelve a descargar las mismas fotos. Devuelve una copia, para que quien la pide no
  cambie lo que veran los demas. Lo guardado tiene tope en bytes (`cache.avatarBytes`, 8 MB por defecto) y se
  descarta lo mas antiguo, igual que con los adjuntos.
- Los identificadores de los mensajes ya vistos, que servian para no anunciar dos veces el mismo, se guardaban
  para siempre: una aplicacion abierta todo el dia los acumulaba sin limite. Ahora se recuerdan los ultimos diez
  mil (`cache.seenMessages`), que es de sobra para lo que puede volver a llegar en la misma sesion.
- `npm run bench:memory` mide lo que retiene una sesion larga.
- Parar el cliente olvida tambien que ya se habia limpiado el borrador de una conversacion. Alguien puede
  haberlo escrito en otra pestana mientras este no miraba, y el siguiente mensaje tiene que limpiarlo.
- Guardar los nombres cinco minutos hacia que un cambio de nombre dentro de una conversacion tardara ese rato en
  verse. Ahora, cuando una conversacion cambia, se olvida lo que se sabia de la gente que hay en ella, que es
  justo cuando alguien puede haberse renombrado. No cuesta peticiones: dentro de una conversacion el nombre sale
  de lo ya sincronizado.
- Un suscriptor de una lista viva que falla ya no deja al resto de la pantalla sin repintar, ni se convierte en
  un error que nadie puede capturar: se avisa por el evento `error` y los demas siguen.
- Con las fotos desactivadas (`cache.avatarBytes: 0`) no se guarda nada, ni siquiera la respuesta de que alguien
  no tiene foto, que era una entrada por persona creciendo sin limite.
- Las listas vivas avisan una vez por tanda en vez de una vez por cambio. Ponerse al dia entrega cientos de
  cambios seguidos y cada uno era un repintado; ahora el contenido esta disponible al momento y el aviso llega
  al final del turno. Un mensaje suelto sigue avisando al momento, y una lista parada ya no se entera de lo que
  venia en camino.
- Esperar a ponerse al dia se quedaba colgado para siempre si alguien paraba el cliente mientras tanto. Ahora
  falla con un motivo claro, que es lo que deja limpiar detras.
- `npm run check:web-demo` abre el ejemplo web en un Chromium de verdad y comprueba el recorrido completo:
  entrar, listar las conversaciones, enviar un mensaje y verlo en pantalla, volver a abrirlo sin que pregunte
  quien eres, un mensaje que llega de otra persona mientras la pantalla esta abierta, y un corte de red con el
  mensaje esperando en pantalla hasta que vuelve. Todo eso era lo que quedaba por comprobar a mano antes de
  publicar, mas enviar un archivo por el formulario y comprobar que se puede volver a descargar. Ademas mide la
  memoria del navegador antes y despues de usarlo un rato: abrir noventa conversaciones
  seguidas no la mueve, que es lo que se espera de unas caches con tope.
- El re-cifrado del almacen (`rekey`) se comprueba tambien contra el IndexedDB real de un navegador, en el
  ejemplo de Electron.
- Todo lo que se hace con una conversacion alcanza mas alla de la ventana, no solo leerla y hablar en ella:
  marcar como leido, reaccionar, corregir, borrar, hilos, adjuntos, y tambien sus ajustes: renombrar, describir,
  avatar, alias, favorita, silencio, fijar mensajes, permisos, roles, expulsar, vetar, salirse e invitar. Marcar
  como favorita era el caso dificil, porque es dato de cuenta: a diferencia de hablar o describir, no adelanta la
  conversacion al principio de la ventana, asi que no llegaba sola.
- Marcar como leido ya no necesita tener el mensaje a mano. El recibo si lo necesita, pero el marcador solo
  necesita saber hasta donde, y quien lee desde un aviso no tiene ese mensaje cargado.
- Una conversacion que se quedo fuera de la ventana se puede abrir igual: se le pide al homeserver esa sola y se
  espera a que llegue. Sin eso, una ventana solo servia mientras nadie mirase mas alla.
- Ventana sobre las conversaciones (`matrix: { conversationWindow: 40 }`): en vez de pedirle al homeserver todas
  las salas al conectar, se le piden las mas recientes y se ensancha al pedir mas. Con 1245 conversaciones,
  ponerse al dia pasa de **14,8 s a 0,2 s**. Va apagada por defecto, asi que nada cambia para quien no la pida.
  Usa la sincronizacion deslizante simplificada, que este Synapse ya sirve.
- El orden de las conversaciones desempata por identificador, para que una lista que crece mientras alguien la
  mira no se reordene sola entre las que no tienen nada dicho.
- Los hilos se leen por su cuenta: `messages.markRead(id, mensaje, { threadId })` mueve el recibo de ese hilo
  sin decir que la conversacion entera esta leida, que es lo que pasaba antes. El recibo va por identificador,
  asi que leer un hilo desde un aviso tampoco necesita tener el mensaje cargado.
- Los hilos de una conversacion se pueden listar: `messages.threads(id)` devuelve raiz, numero de respuestas,
  la ultima y cuantas quedan sin leer. Se le piden al homeserver de una vez; antes, saber que hilos tenian algo
  nuevo obligaba a abrirlos uno a uno, una peticion por hilo en cada repintado.
- Silenciar a una persona sin ignorarla: `push.mute`, `push.unmute` y `push.muted`. Lo que dice sigue llegando,
  solo deja de interrumpir. Ignorar ya existia y es otra cosa: ahi los mensajes ni llegan.
- Cuanto puede interrumpir todo, para la cuenta entera: `push.level()` y `push.setLevel("all" | "mentions" |
  "none")`. Antes solo se podia decidir conversacion por conversacion.
- Encuestas: `polls.start`, `vote`, `close` y `list`. Preguntar algo a la conversacion y contar los votos, con
  la regla del protocolo de que cambiar de idea sustituye el voto anterior en vez de sumarse, y de que cerrar
  es definitivo. Los nombres de los eventos los pone el SDK, que ademas conoce el nombre inestable que usan los
  clientes que se adelantaron al spec: sin eso, una encuesta creada por Element no se veria.
- Compartir donde estas mientras te mueves: `location.start`, `update`, `stop` y `list`. El rato es obligatorio
  y como mucho un dia, a proposito: lo que hace segura esta funcion es que acabe sola, porque sin un final un
  descuido deja a alguien contando donde esta indefinidamente.
- Pegatinas: `messages.sendSticker`. No son un adjunto, son su propio tipo de evento, y llegan con
  `kind: "sticker"` para que quien las recibe las pinte solas, sin nombre de fichero ni boton de descarga.
- Previsualizacion de enlaces: `media.preview(url)`. La pide el homeserver, no el dispositivo, asi que quien
  publica el enlace no se entera de que alguien de esta organizacion lo esta mirando. El mismo enlace no se
  pregunta dos veces en media hora.
- Las imagenes pueden llevar su borron (`blurhash`), para pintar algo de su tamano y color mientras llegan, en
  vez de un hueco que salta cuando carga.
- La politica de cifrado la decide el homeserver, no la libreria. Antes toda conversacion nueva se creaba
  cifrada a la fuerza, pisando `encryption_enabled_by_default_for_room_type` del operador. Ahora el evento de
  cifrado solo se manda cuando se pide con `encrypted: true`; sin decir nada, decide quien administra el
  servidor, que es quien tiene el contexto legal y de soporte. En Matrix el cifrado solo se puede sumar y
  nunca quitar, asi que `encrypted: false` significa "yo no lo pido", no "garantizo que no".
- `Conversation` dice ahora `isEncrypted`: lo que la conversacion **es**, no lo que se pidio al crearla. Sin
  eso, un homeserver que cifra por politica dejaba a la aplicacion creyendo que podria leer un historial que
  en realidad es una caja cerrada. Al crear se le pregunta al servidor con `getStateEvent`, porque la
  sincronizacion cuenta el cifrado medio segundo mas tarde y sobre esto no se puede suponer.
- Las notificaciones se comprueban de extremo a extremo. El entorno levanta un gateway de verdad, dentro de la
  red de Docker, y una comprobacion registra un dispositivo, envia un mensaje desde otra cuenta y verifica dos
  cosas: que el aviso **llega**, y que el mensaje **no va dentro**. Lo segundo era una afirmacion de privacidad
  que estaba escrita en un comentario y nunca se habia demostrado.
- Una sesion retirada desde fuera se avisa: nuevo evento `session.ended`. Quien administra las cuentas puede
  suspender a alguien o revocarle el token desde otro sitio, y hasta ahora el cliente se quedaba a medias sin
  decir nada; habia que deducirlo del codigo de un error que se lanzara por casualidad. Ahora el cliente se
  para y lo dice, para que una aplicacion pueda llevar a esa persona a la pantalla de entrada.
- El entorno de desarrollo y el de integracion continua se levantan con la misma orden, `npm run matrix:up`,
  sobre PostgreSQL en vez de SQLite. Antes la configuracion del homeserver no estaba versionada, asi que cada
  uno levantaba el suyo y podian diferir sin que nadie lo notara. `dev-rate-limits.yaml` pasa a `dev.yaml`,
  porque hace tiempo que no son solo limites.
- Leer sin que se note: `messages.markRead(id, mensaje, { private: true })` mueve el marcador de esa persona
  sin decirle a nadie hasta donde ha leido. Antes leer siempre avisaba al otro lado, sin alternativa.
- Volver a dejar una conversacion como no leida: `conversations.setUnread(id, true)`, y `isUnread` en la
  conversacion. Es una marca propia, guardada en el servidor, asi que viaja entre dispositivos. Se quita sola
  al leer de verdad, y quitarla no cuesta ninguna peticion cuando no habia marca, que es casi siempre.
- Lo que el servidor tiene esperando: `push.pending({ limit })`. Una aplicacion que se cerro no tiene eventos
  con los que deducirlo, asi que pregunta en vez de adivinar con lo que le haya quedado.
- Buscar personas por el nombre que usan: `users.search(texto, { limit })` pregunta al directorio del
  homeserver. Antes solo se podia invitar a alguien si ya sabias su identificador entero, que no es algo que
  nadie escriba de memoria desde una pantalla.
- Las fotos se pueden pedir del tamano al que se van a ver: `users.avatar(id, { size: 32 })`. El servidor
  redimensiona antes de enviar. Con un retrato de 256 px, pedirlo pequeno baja **197 KB a 1,8 KB**, 109 veces
  menos, y una lista pinta decenas de estos. `users.avatar` pasa a recibir opciones en vez de la conversacion
  suelta, porque ahora hay dos cosas que decirle.
- La recuperacion se pone en marcha en el unico orden que funciona, y son tres pasos, no dos. Primero el
  almacen nuevo, porque hasta que su clave no es la que manda, todo lo que pide una clave recibe la anterior,
  que ya no puede abrir nadie. Luego la identidad, siempre nueva: lo que la cuenta tuviera esta en el almacen
  viejo e ilegible, asi que conservarla dejaria una identidad con la que no se puede firmar nada. Y solo
  entonces se guarda la identidad en el almacen, o viviria en ese dispositivo y solo en ese. Antes se hacian
  dos pasos en el orden contrario y la recuperacion podia quedarse a medias sin decirlo.
- El adaptador de Matrix usa las constantes del propio SDK (`EventType`, `MsgType`, `RelationType`,
  `ReceiptType`, `RuleId`) en vez de repetir las cadenas del protocolo a mano. Donde no hay constante porque el
  SDK no la tiene, sigue la cadena, pero ya no hay ninguna escrita a mano que el SDK supiera nombrar.
- Poner en marcha la recuperacion ya no termina antes de tiempo: subir la identidad de firma cruzada y verla no
  son el mismo momento, y hasta que no se le pide al homeserver, la cuenta no sabe que la tiene y responde que
  la recuperacion no esta lista. `recover` ya bajaba la identidad propia por esta misma razon; `setupRecovery`
  no.
- El smoke de recuperacion ya no espera por el contador de claves del servidor en ningun punto. Ese contador va
  por detras, y con una cuenta cargada va muy por detras: fallaba una de cada dos veces sin que hubiera nada
  roto. Comprueba lo unico que importa, que el otro dispositivo puede leer.
- El smoke de caida avisa si el homeserver ya estaba parado, en vez de fallar de forma confusa. Ese smoke lo
  para a proposito, y una ejecucion interrumpida lo dejaba asi.
- Enviar espera a que la conversacion este lista, como ya hacia unirse, y si aun asi el cifrado de esa sala no
  ha llegado, espera por el y lo intenta una vez mas. Eso no se puede prever: una conversacion que no se ha
  puesto al dia y una que sencillamente no esta cifrada se ven igual, asi que el fallo es la unica senal que
  hay. El mensaje sale; lo unico que queda es una linea de queja que escribe el sdk por su cuenta.
- `conversations.list({ limit })` devuelve solo las primeras, las de actividad mas reciente, para que una
  pantalla con miles de conversaciones pinte unas pocas y pida mas al hacer scroll. Sin decir cuantas, siguen
  llegando todas.
- `messages.list(id, { atLeast })` trae mensajes mas antiguos hasta tener bastantes que leer. Sirve para pedirle
  poco al homeserver al arrancar sin que abrir una conversacion se quede en un mensaje suelto. Con 1245
  conversaciones, ponerse al dia pasa de 14,8 s pidiendo veinte mensajes por conversacion a 3,6 s pidiendo uno.
- Una reaccion, una correccion o un borrado hechos sin homeserver se recuerdan y se hacen cuando vuelve la
  conexion, como ya pasaba con los mensajes. Mientras tanto la pantalla muestra lo que sera, y de varias
  correcciones seguidas solo sale la ultima: las del camino no las vio nadie. Esto vive solo mientras el cliente
  esta en marcha; lo que tiene que sobrevivir a cerrarlo va por la cola de envio, que si se guarda.
- Marcar como leido sin homeserver ya no le salta a la cara a quien solo abrio una conversacion: se recuerda
  hasta donde leyo y se cuenta cuando vuelve la conexion, como ya hacia la cola de envio. Solo se cuenta el
  punto mas lejano, no cada paso.
- Los nombres se guardan en local: una pantalla sin homeserver sigue mostrando como se llama cada persona en
  vez de su identificador. Antes, tras reiniciar y sin red, todo eran identificadores. Se borran al cerrar
  sesion, como todo lo demas.
- Una conversacion dice ahora que mensajes tiene fijados (`Conversation.pinnedIds`), y `conversations.pinned`
  los sigue devolviendo sin homeserver, tirando de lo que ya hay guardado. Antes se quedaba en blanco sin red.
- Lo que cuelga de un hilo se guarda en local como el resto de la conversacion: un hilo ya abierto se sigue
  leyendo sin homeserver, igual que el timeline principal. Antes un hilo sin red se quedaba en blanco aunque la
  conversacion de al lado si se viera.
- Decidir que se guarda de una conversacion deja en paz lo que cuelga de sus hilos, que no es parte del timeline
  principal y se habria borrado en cada lectura.
- La lista viva ordenaba los mensajes solo por la marca de tiempo, sin el desempate que si usa el cliente, asi
  que con mensajes de la misma marca la pantalla podia mostrarlos en otro orden que `messages.list`. Ahora las
  dos ordenan igual.
- Mirar mas atras en una conversacion escribia en el almacen todo el historial que traia, y la siguiente lectura
  lo borraba otra vez por el limite de cache. Ahora decide de una vez que se guarda, igual que ya hacia al abrir
  la conversacion. Era el mismo desgaste, en el otro camino.
- Abrir la aplicacion otra vez cuesta 685 ms hasta tener las conversaciones en pantalla, sin volver a pedir
  quien eres: el ejemplo web guarda la sesion y entra directo. Comprobado en un Chromium de verdad.
- Al parar el cliente se le da un turno a lo que la sincronizacion tuviera a medias antes de soltarlo, porque el
  sdk libera el cifrado antes de parar la sincronizacion y ese trabajo a medias iba a buscar algo que ya no
  estaba.
- `client.start({ waitForSync: false })` vuelve en cuanto el cliente esta en marcha, sin esperar a que el
  homeserver conteste, y hasta que se pone al dia se muestra lo que ya habia guardado. Medido con 354
  conversaciones y una sala de 201 personas: pintar la primera pantalla pasa de **1829 ms a 0,7 ms**. Arrancar
  como hasta ahora sigue esperando, asi que nada cambia para quien no lo pida. Lo que quedo en la cola de envio
  sale igual, en cuanto hay por donde mandarlo. Cerrar la aplicacion mientras se pone al dia la deja parada de
  verdad, sin anunciarse conectada despues ni enviar nada, y si ponerse al dia falla el cliente queda parado en
  vez de aparentar que funciona.
- Los perfiles se recuerdan durante cinco minutos. Pintar una lista de conversaciones preguntaba el nombre de
  cada persona una y otra vez: medido contra Synapse con 272 conversaciones y 19 personas, pintar tres veces
  pasa de 57 peticiones a 19. Cambiar el propio nombre o la propia imagen olvida lo recordado al momento, y
  cerrar sesion lo olvida todo.
- `npm run bench:round-trips` cuenta cuantas veces se pregunta al homeserver al pintar una pantalla, y
  `npm run bench:big-room` monta una sala con doscientas personas de verdad y mide lo que cuesta ponerse al dia.
- Enviar un mensaje ya no escribe en el almacen el estado "enviandose". Ese estado dura lo que dura la peticion,
  y escribirlo dejaba un mensaje atascado en "enviandose" tras un cierre inesperado cuando en realidad seguia en
  cola. Se sigue anunciando, que es lo que pinta la pantalla.
- Enviar ya no borra el borrador de la conversacion cada vez aunque no hubiera ninguno: se limpia una vez por
  conversacion y sesion, y vuelve a limpiarse si se escribio algo nuevo.
- Abrir una conversacion larga escribia el timeline entero en el almacen y despues borraba lo que sobraba del
  limite de cache, en cada lectura. Con 150 conversaciones de 1.000 mensajes eso eran 59 segundos por apertura.
  Ahora se decide de una vez que se guarda (los mas recientes hasta el limite, mas lo que sigue en cola) y se
  escribe y se borra en una sola pasada: 18 ms la primera vez y 11 ms las siguientes.
- El corte de la cache se decidia por posicion y con mensajes de la misma marca de tiempo se movia en cada
  lectura, asi que los mismos mensajes se escribian y se borraban para siempre. Ahora el identificador desempata
  y el corte se queda quieto. Un backfill deja muchos mensajes con la misma marca, asi que no es un caso raro.
- Borrar mensajes del almacen tambien va en una sola transaccion.
- El almacen local esta indexado por conversacion y por estado. Abrir una conversacion leia y descifraba todos
  los mensajes de todas las conversaciones: con 60 conversaciones y 24.000 mensajes eso son 376 ms, frente a
  7,5 ms preguntando al indice. Las bases de datos creadas antes reciben los indices al abrirse.
- La busqueda local para en cuanto tiene bastante (cincuenta por defecto, `messages.search(query, { limit })`) y
  empieza por las conversaciones con actividad mas reciente. Antes descifraba todo el historial aunque lo que
  buscabas estuviera en el primer mensaje.
- `npm run bench:local` mide lo que cuesta una cuenta cargada en esta maquina, sin homeserver de por medio.
- Escribir ya no manda una peticion por tecla: se avisa la primera letra y se renueva justo antes de que el aviso
  caduque. Parar se dice siempre y al momento, porque el otro lado esta esperandolo.
- Marcar como leido no repite lo que ya se dijo. Una aplicacion llama a esto cada vez que se abre una
  conversacion, y hasta ahora eso era una peticion por apertura aunque no hubiera nada nuevo.
- Las escrituras al almacen local van en una sola transaccion en vez de una por registro. Leer un timeline de
  quinientos mensajes abria quinientas transacciones de IndexedDB.
- La lista viva de conversaciones se actualiza en el sitio en vez de releerlas todas. Antes, un mensaje en
  cualquier conversacion hacia releer y remapear la lista entera.
- Comparar snapshots empieza por la identidad de cada objeto, que casi siempre es la misma y no cuesta nada.

### Corregido

- El smoke de recuperacion comprobaba que el servidor contase una clave mas, y ese contador va por detras: dos de
  cada cuatro ejecuciones fallaban sin que hubiera nada roto. Ahora comprueba lo unico que importa, que el
  dispositivo nuevo puede leer lo que se dijo despues de activar la recuperacion.
- El adaptador de pruebas entregaba las conversaciones con el contador de no leidos al listarlas pero sin el al
  avisar de un cambio, asi que el contador desaparecia y volvia. Ahora sale igual por los dos caminos.
- El smoke de federacion daba un minuto al primer mensaje que cruza entre dos servidores, y en frio eso a veces
  no llega: es el momento en que los dos se intercambian las claves. Ahora espera lo que haga falta para ese
  primero, que es el unico lento; los demas van al momento.
- El entorno de federacion espera a que los dos servidores se alcancen de verdad antes de darse por listo.
  Responder al API de cliente no basta: arrancando en frio todavia tienen que intercambiarse las claves, y el
  smoke fallaba por empezar antes de tiempo.
- Verificar a otra persona sin nombrar ninguno de sus dispositivos: `verification.request(userId)` ocurre dentro
  de la conversacion que comparten, y se abre si no habia ninguna. Verificado entre dos cuentas reales.
- Cambiar la clave de una conversacion con `conversations.rotateKeys`: lo que se diga a partir de ahi va con una
  clave nueva, y quien conserve la vieja se queda solo con lo anterior. Verificado cifrado contra Synapse.
- Dejar de confiar en un dispositivo con `devices.revoke`, que es lo que se hace cuando uno se pierde.
- Verificacion por codigo: `verification.request(userId, deviceId, { method: "code" })` deja el metodo abierto,
  `verification.qrCode` devuelve lo que hay que dibujar y `verification.scan` lee el que muestra el otro
  dispositivo. `verification.confirm` sirve para las dos formas: comparar emoji o decir que si se escaneo.
  Verificado entre dos dispositivos reales contra Synapse en `scripts/smoke-qr.mjs`.
- Pedir verificacion sin decir el metodo sigue comparando emoji, como hasta ahora.
- `IndexedDbStorage.rekey(nuevoSecreto)` reescribe todo lo guardado con otro secreto. Antes cambiar el secreto
  dejaba cada registro ilegible y se tiraba la copia local entera. Lo que ya no se puede leer se descarta, en vez
  de dejar el almacen a medias entre dos secretos.
- El nombre de una persona puede ser distinto en una conversacion que en el resto: `users.profile(userId,
  conversationId)` devuelve el que usa ahi. Antes siempre se mostraba el global, que en un grupo puede ser otro.
- Cache de descargas en memoria con limite en bytes (`cache.downloadedBytes`, 32 MB por defecto): abrir dos veces
  el mismo archivo ya no lo baja ni lo descifra dos veces. Se vacia al cerrar sesion y devuelve una copia, para
  que quien la pide no cambie lo que veran los demas.
- Limite de conversaciones guardadas en local (`cache.conversations`). Se conservan las de actividad mas
  reciente, y una con algo pendiente de enviar no se descarta nunca.
- La presencia llegaba a veces si y a veces no: se escuchaba el canal atado a cada persona, que `matrix-js-sdk`
  solo reemite cuando fue el propio evento de presencia quien creo el objeto de esa persona. Ahora se lee del
  canal general de eventos, que los entrega siempre.
- El estado de presencia se valida antes de salir: un valor que el homeserver no entiende se rechaza aqui en vez
  de volver como un error del servidor, y un mensaje de estado demasiado largo tambien.
- Nuevo error `CONVERSATION_NOT_FOUND`, para distinguir una conversacion que no existe de una entrada invalida.
- Sustituir una conversacion por otra: `conversations.upgrade` y `conversations.current`, que sigue la cadena de
  sustituciones hasta la conversacion en la que esta la gente. `Conversation.replacedBy` y `replaces` dicen a
  donde va y de donde viene, verificado contra Synapse real.
- Palabras por las que merece la pena interrumpir: `push.watchFor`, `push.stopWatchingFor` y `push.keywords`.
- Donde se quedo cada persona: `markRead` guarda ademas el marcador de lectura, `Conversation.lastReadMessageId`
  dice hasta donde leyo y `messages.unreadSince` devuelve lo que llego despues. Viaja con la cuenta, asi que se
  respeta en todos sus dispositivos y en cualquier otro cliente Matrix.
- Denunciar un mensaje a quien administra el homeserver con `messages.report`.
- Encontrar conversaciones publicas: `conversations.setAlias`, `publish` y `discover`. Una conversacion a la que
  solo se entra por invitacion no aparece en la lista aunque se publique.
- Lo que el adaptador reporta como cambiado se guarda en el almacen local, no solo se anuncia. Antes cualquier
  lectura local se quedaba con la version anterior hasta que alguien volvia a listar las conversaciones.
- Reenviar un mensaje a otra conversacion con `messages.forward`. Un archivo se descarga y se vuelve a enviar en
  lugar de apuntar al original, porque la copia de una conversacion esta cerrada con una clave que la otra no
  tiene; verificado cifrado contra Synapse en el smoke de chat.
- Notas de voz (`messages.sendVoice`) con duracion y forma de onda, que se distinguen de un archivo de audio
  cualquiera, y sitios del mapa (`messages.sendLocation`), verificados cifrados contra Synapse.
- Quien puede entrar y hasta donde se puede leer: `conversations.setJoinRule` ("invite", "public", "knock") y
  `setHistoryVisibility`. Quien esta fuera pide entrar con `conversations.knock` y quien esta dentro ve la
  espera en `knockingIds`, verificado entre tres cuentas reales en el smoke de grupo.
- Borradores locales: `conversations.saveDraft` y `conversations.draft`. Se guardan cifrados en IndexedDB,
  sobreviven a cerrar la aplicacion, se limpian al enviar el mensaje y desaparecen al cerrar sesion.
- Avisos con la aplicacion cerrada: `push.register`, `push.registered` y `push.unregister`, que registran una
  pasarela de push en el homeserver. Solo viaja el identificador del evento, no lo que se dice.
- Al cambiar el silencio de una conversacion se refrescan las reglas antes de responder. Antes se contestaba con
  la copia local anterior, asi que quitar el silencio devolvia la conversacion todavia silenciada.
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
