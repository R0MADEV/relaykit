# LiveKit — donde se lleva una videoconferencia

Synapse no lleva el audio ni el vídeo de una conferencia, igual que no los lleva en una llamada de dos. Lo
que aporta Matrix es **quién puede entrar y quién está dentro**; el audio, el vídeo y la pantalla compartida
van por un SFU, y ese SFU es LiveKit.

```
npm run livekit:up
```

## Las dos piezas

| | Puerto | Qué hace |
|---|---|---|
| `livekit` | 7880 | El SFU. Cada quien sube su vídeo **una vez** y él lo reparte |
| `jwt` | 8091 | Convierte "esta persona está en esta sala de Matrix" en un token que el SFU acepta |

Sin la segunda, el SFU admitiría a cualquiera: **LiveKit no sabe quién eres**. Solo obedece a un token, y ese
token se emite porque el homeserver dijo que sí.

El intercambio es este, y es lo único que el SDK tiene que hacer a mano:

```
POST /sfu/get  { room, openid_token, device_id }  ->  { url, jwt }
```

El token de OpenID no se cree: el servicio lo lleva **de vuelta al homeserver** para que le digan de quién es.
Por eso un identificador de sala robado no mete a nadie.

## Lo que hay que saber

Cuatro obstáculos, todos del entorno y ninguno de la librería. Los cuatro salieron a la primera ejecución del
smoke, igual que pasó con la federación.

- **`LIVEKIT_FULL_ACCESS_HOMESERVERS` es obligatorio.** El servicio se niega a arrancar sin él, y hace bien:
  uno que admitiera el homeserver de cualquiera admitiría a cualquiera. Aquí vale `localhost`, que es como se
  llama a sí mismo el Synapse de desarrollo.
- **El servicio pregunta por federación, y federación es `https://<server_name>:8448`.** Con `server_name:
  localhost`, dentro de su contenedor eso es él mismo, y ahí no hay nada. El síntoma fue un `401` con
  `Connection refused (os error 111)` en su log. Lo resuelve `homeserver-federation`: un `socat` que
  **comparte el namespace de red del servicio** — por eso *es* su localhost — escuchando en el 8448 con TLS y
  reenviando al Synapse de fuera por el 8008. Funciona porque el Synapse de desarrollo sirve la API de
  federación también en el 8008 (`resources: [client, federation]`), solo que sin TLS.
- **`LIVEKIT_URL` hace dos trabajos con un valor.** El servicio llega al SFU por él para crear la sala, y le
  entrega la misma cadena al navegador para conectarse. Dentro de Docker el SFU es `livekit`; para un
  navegador es `localhost`. Solo un nombre puede ser cierto en los dos sitios, así que `sfu-as-localhost`
  hace que `localhost:7880` también lo sea dentro. El síntoma fue `500 Unable to create room on SFU`.
- **El puerto 8091 y no el 8090**: el 8090 ya estaba cogido en la máquina donde se montó esto.

Y tres cosas que no son obstáculos pero conviene saber:

- **La sala que ve el SFU es un hash**, no el identificador de Matrix. El servicio no le cuenta a la pieza que
  lleva el vídeo en qué sala está nadie. El smoke no comprueba *cómo* hashea, que es asunto suyo: comprueba
  que dos leaves para la misma conversación coinciden y que uno para otra no.
- **La membresía se escribe hoy como `org.matrix.msc3401.call.member`**, con clave
  `_@usuario:servidor_DISPOSITIVO_m.call`, aunque el SDK ya declara el nombre nuevo (`msc4143`). Es el SDK
  quien la escribe, así que el día que cambie no hay nada que tocar aquí; el smoke pregunta por los dos.
- **El SDK intenta primero `/_matrix/client/unstable/org.matrix.msc4143/rtc/transports`** para descubrir
  dónde se lleva la conferencia, y Synapse responde `404`. Es ruido en el log, no un fallo: cae al
  `.well-known`, que es lo que lee `matrix-rtc.ts`.

## Solo para desarrollo

El secreto está en el fichero, no hay TLS y se confía en el homeserver por HTTP. En producción hacen falta
las tres cosas, y además **`turns:` en el 443 con certificado de verdad**: el TURN que LiveKit trae dentro es
lo que salva una conferencia en una oficina que bloquea UDP, y sin TLS en el 443 no pasa ese cortafuegos.

## Cómo lo encuentra un cliente

En producción, el homeserver lo anuncia en su `.well-known/matrix/client`:

```json
{ "org.matrix.msc4143.rtc_foci": [{ "type": "livekit", "livekit_service_url": "https://..." }] }
```

Una máquina de desarrollo no tiene `.well-known` que anunciar nada, así que el adapter acepta
`conferenceServiceUrl` para decírselo a mano.

## Lo que se comprueba y lo que no

`npm run smoke:conference` prueba **la mitad Matrix contra servidores de verdad**: descubrir el foco, el
intercambio OpenID → token contra el servicio real, que el token queda atado a esa sala y a ese dispositivo,
que al entrar la sala lo dice y otra persona lo lee, y que al salir deja de decirlo. Es donde estaban todas
las suposiciones, y todas fallaron al menos una vez antes de quedar bien.

Lo que **no** prueba es la imagen y el sonido: eso necesita navegador, y va en la comprobación con Electron
(`scripts/check-calls.cjs`), que sigue pendiente para conferencias. Tampoco prueba el **cifrado**: las claves
las reparte el SDK por Matrix y el motor de LiveKit cifra cada frame con ellas antes de que salga del
navegador (`conference-keys.ts`), pero que el SFU de verdad no pueda leer lo que lleva solo se ve con dos
navegadores hablando. Está conectado, no comprobado.
