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

- **`LIVEKIT_FULL_ACCESS_HOMESERVERS` es obligatorio.** El servicio se niega a arrancar sin él, y hace bien:
  uno que admitiera el homeserver de cualquiera admitiría a cualquiera. Aquí vale `localhost`, que es como se
  llama a sí mismo el Synapse de desarrollo.
- **El rango de UDP es corto a propósito** (50000-50019). Docker Desktop publica los puertos UDP de uno en
  uno, y mil de ellos tardan minutos en levantar.
- **`--node-ip 127.0.0.1`**: sin eso el servidor reparte la dirección que tiene dentro de Docker, que no
  significa nada para un navegador.
- **El secreto tiene que medir 32 caracteres o más** o LiveKit no arranca.
- **El puerto 8091 y no el 8090**: el 8090 ya estaba cogido en la máquina donde se montó esto.

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

## Lo que está sin comprobar

El entorno levanta y el servicio de tokens responde. Lo que **no** se ha probado todavía es una conferencia de
verdad: hacen falta tres navegadores, y eso va en `scripts/smoke-conference.mjs` y en la comprobación con
Electron, que están pendientes.
