# Las piezas

Qué usa RelayKit, qué hace cada cosa y por qué está. Nada de esto lo escribimos nosotros: la regla del
proyecto es usar lo que la plataforma, el SDK y el ecosistema Matrix ya dan.

Para la superficie que la biblioteca ofrece a una aplicación, ver [API.md](API.md).

---

## Lo que va dentro de la biblioteca

### `matrix-js-sdk`

El SDK oficial de Matrix, y prácticamente lo único de lo que depende `@relaykit/matrix-js`. Hace **todo** lo
que habla con el protocolo:

| Qué | Quién |
|---|---|
| Sincronización, salas, eventos, paginación | `MatrixClient` |
| Cifrado extremo a extremo (megolm/olm) | su máquina de cifrado en Rust, compilada a WASM |
| Verificación de dispositivos, SAS y QR | `crypto.*` |
| Copia de seguridad de claves y recuperación | `secretStorage`, `keyBackup` |
| Llamadas de voz y vídeo | `MatrixCall` y `createCall()` |
| Peticiones HTTP autenticadas | `client.http.authedRequest` |

**Cero HTTP propio.** En toda la biblioteca hay dos peticiones directas, y las dos van por el cliente
autenticado del SDK: descargar media (que necesita autenticación) y `/notifications`, que el SDK solo alcanza
por su propia línea de notificaciones y esa solo pide las destacadas.

**Cero WebRTC propio.** Ni una oferta SDP, ni un candidato ICE, ni un evento `m.call.*` escrito a mano.

### `SlidingSync` (MSC3575)

Parte del mismo SDK, pero no está en su superficie pública, así que se alcanza por su ruta. Es lo que hace que
abrir la aplicación con 1.245 conversaciones tarde **195 ms**: en vez de traerse todas, pide una ventana de las
más recientes y va ampliándola.

También decide **cuánto estado** pide de cada conversación. Pedir de menos aquí rompió las llamadas de una
forma que no se parecía en nada a la causa, así que:

- la **lista** pide los miembros con `$LAZY`, que es lo que Matrix tiene para no traerse a todo el mundo
- la **conversación que se usa** los pide **todos**, porque ahí es donde se pregunta quién está y donde ocurre
  una llamada

### `matrix-encrypt-attachment`

Cifra y descifra los adjuntos según la especificación de Matrix (AES-CTR, con la clave y el hash viajando en el
evento). Un archivo en una sala cifrada no se sube en claro, y esto es lo que hace ese paso.

### IndexedDB y `crypto.subtle`

La copia local (`@relaykit/browser-storage`), del navegador, no de una librería. Los datos se cifran con
**AES-GCM** usando una clave derivada de un secreto de la aplicación.

Requiere **origen seguro**: sin `https` no existe `crypto.subtle` y no hay copia local. Por eso la comprobación
en navegador se sirve por https con un certificado propio y no por `http://localhost`, que el navegador trata
como seguro por excepción y por tanto no prueba lo que verá un usuario.

La copia local es una **comodidad, no la verdad**: la verdad está en el homeserver. Si el almacén falla, se
informa y se sigue, y lo que no se pudo guardar se vuelve a pedir.

---

## Lo que hay que tener corriendo

Todo esto lo levanta `sh infrastructure/matrix/up.sh`, y **la misma orden** se usa en desarrollo y en
integración continua, para que no puedan divergir.

### Synapse — el homeserver

El servidor Matrix de referencia. Es quien guarda las conversaciones, reparte los mensajes, federa con otros
servidores y decide quién puede qué.

Una aplicación no habla con RelayKit sin un homeserver detrás: RelayKit es el lado cliente.

La configuración de desarrollo (`dev.yaml`) sube los límites de peticiones, permite crear cuentas, abre el
directorio de personas y la lista pública de salas, y activa la previsualización de enlaces. **Nada de eso vale
para producción**, y el fichero lo dice.

### PostgreSQL

La base de datos de Synapse. Synapse trae SQLite por defecto y él mismo avisa de que SQLite es solo para
pruebas: un entorno de desarrollo que no se parece al de producción mide cosas que no le pasan a nadie.

### coturn — el relé de las llamadas

Cuando dos personas están cada una detrás de su router, **no pueden verse**: las direcciones que se ofrecen
(`192.168.1.133`) no significan nada fuera de su propia red. La llamada se queda en `connecting` para siempre.

coturn es un servidor con dirección alcanzable por el que **pasa** el audio y el vídeo. Los dos se conectan a él
y él reenvía.

El homeserver **no reenvía nada**: reparte credenciales temporales hechas con un secreto que comparte con
coturn, y que caducan, porque un relé que cualquiera puede usar para siempre es un relé que cualquiera usará
para todo.

Sin esto, una llamada funciona entre dos ventanas del mismo ordenador y deja de funcionar en cuanto la prueban
dos personas de verdad. Durante mucho tiempo el SDK dijo en cada llamada:

```
failed to get TURN credentials! Proceeding with call anyway...
```

Con coturn en pie, en una llamada real aparecen candidatos `typ relay`, que es el relé usándose y no solo
anunciándose.

**Solo para desarrollo tal como está**: el secreto está en el fichero, no hay TLS, y apuntar el relé a una red
privada está denegado a propósito.

### El gateway de notificaciones

Un contenedor mínimo que apunta lo que le llega. No es parte de la biblioteca: está para poder comprobar que
una notificación **llega de verdad** y que lo dicho en una sala cifrada se queda entre los dispositivos.

---

## Lo que se usa para comprobar

| Pieza | Para qué |
|---|---|
| `node --test` | Unidades y contrato. Sin framework: viene con Node |
| Docker Compose | Levanta Synapse, PostgreSQL, coturn y el gateway |
| Electron | Un navegador de verdad. Es el único sitio donde se puede probar WebRTC, `crypto.subtle` y la interfaz |
| Vite | Construye y sirve el ejemplo web |
| Synapse real | Las pruebas de humo no usan dobles: hablan con un homeserver |

### Los tres niveles

1. **Unidades** — rápidas, contra dobles. Prueban nuestra lógica.
2. **Contrato** — los **mismos** tests contra los **dos** adaptadores, el de Matrix y el de memoria. Si el
   núcleo supiera algo de Matrix, el de memoria no podría pasarlos. Esa es la prueba de que se puede sustituir.
3. **Humo** — contra Synapse real, con cuentas recién creadas. Es donde aparecen las cosas que un doble nunca
   enseña: leer justo después de escribir, el estado que tarda, la federación.

Más una comprobación en navegador que llama de verdad entre dos ventanas, y otra que ejercita el ejemplo.
