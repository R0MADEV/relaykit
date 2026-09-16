# Arquitectura

Para quien llega a cambiar algo y necesita saber **dónde va**. Empieza por la decisión, sigue por la regla que
no se rompe, y acaba en recetas: "quiero hacer X, ¿qué toco?".

---

## La decisión

**Puertos y adaptadores.** El núcleo describe lo que la mensajería *es*; los adaptadores describen cómo lo
hace un backend concreto.

```text
Aplicación
    │
    ▼
@relaykit/web ──────► @relaykit/core ◄────── @relaykit/in-memory
   (arma las piezas)     (sin dependencias)      (el doble de los tests)
    │                          ▲
    │                          │
    └──► @relaykit/matrix-js ──┘
         @relaykit/browser-storage
```

## La regla que no se rompe

> **`core` no sabe que Matrix existe.**

Es comprobable, y se comprueba:

```bash
grep -r "matrix-js-sdk\|livekit\|IndexedDB\|window\.\|document\." packages/core/src
# no debe devolver nada
```

`packages/core/package.json` no tiene **ninguna** dependencia. Si añades una, has roto la arquitectura.

| Paquete | Puede importar |
|---|---|
| `core` | nada |
| `in-memory` | `core` |
| `matrix-js` | `core`, `matrix-js-sdk`, `livekit-client` |
| `browser-storage` | `core` |
| `web` | `core`, `matrix-js`, `browser-storage` |

---

## Dónde vive cada cosa

### `packages/core/src` — qué es la mensajería

| Archivo | Qué es |
|---|---|
| `client.ts` | **La superficie pública.** <!-- operations: 156 -->156 operaciones en 16 grupos, una línea cada una. Nada de lógica aquí |
| `adapter.ts` | **El puerto.** 17 métodos que un backend debe tener |
| `capabilities.ts` | Las <!-- capabilities: 22 -->22 mitades opcionales que puede dejar fuera |
| `models/` | Las formas que se devuelven. Nada de Matrix en ellas |
| `*-operations.ts` | **La lógica.** Una clase por asunto: conversaciones, mensajes, llamadas, cripto… |
| `live.ts` | Listas que se mantienen solas: `createConversationList`, `createMessageTimeline` |
| `events.ts` | El bus tipado |
| `errors.ts` | `RelayKitError` y sus códigos. **La lista es la promesa pública** |
| `diagnostics.ts` | El canal de log. **No** es API de interfaz: se puede mover |
| `unavailable-adapter.ts` | Lo que responde cuando no hay backend configurado |

Cuando una clase de operaciones junta dos asuntos, se parte por el asunto — no por longitud:
`conversation-operations` / `-settings` / `-moderation`, `message-operations` / `-sending` / `-read-state`.

### `packages/matrix-js/src` — cómo lo hace Matrix

| Prefijo | Qué es |
|---|---|
| `matrix-js-adapter.ts` | Implementa el puerto. Delega, no decide |
| `matrix-runtime.ts` | El cliente del SDK, el sync, los handlers, la ventana |
| `matrix-mapper.ts`, `matrix-conversation-mapper.ts` | **Traducir**: evento → `Message`, sala → `Conversation` |
| `matrix-<asunto>.ts` | Cada asunto contra el SDK: `-sending`, `-media`, `-permissions`, `-conference`… |
| `call-memberships.ts`, `geo-uri.ts`, `reading-content.ts` | **Puro**: datos a datos, sin red. Lo único testeable sin homeserver |

### `packages/in-memory/src` — el doble

Implementa el puerto entero con `Map`s. **No es un mock**: es un backend de verdad que vive en memoria. Los
680 tests unitarios corren contra él, sin red.

### `examples/web/src/app` — la aplicación

Un archivo por pantalla o por asunto. Ninguno pasa de 300 líneas. `app.ts` solo arma las piezas.

---

## Recetas

### Añadir una operación a algo que ya existe

Ejemplo: `conversations.pin`.

1. **Modelo** — si devuelve algo nuevo, `core/src/models/<asunto>.ts`
2. **Puerto** — el método en `packages/core/src/capabilities.ts` (o en `adapter.ts` si de verdad es obligatorio)
3. **Test en rojo** — `tests/<asunto>.test.mjs`, contra el doble
4. **Lógica** — `core/src/<asunto>-operations.ts`
5. **Fachada** — una línea en `client.ts`
6. **Doble** — `in-memory/src/in-memory-<asunto>.ts`
7. **Matrix** — `matrix-js/src/matrix-<asunto>.ts` + una línea en `matrix-js-adapter.ts`
8. **Contrato** — un caso en `tests/adapter-contract.test.mjs`, que corre contra los dos
9. **Documentar** — `API.md` y, si es visible, `README.md`

### Añadir una capacidad entera

Cuando un backend podría legítimamente no tenerla.

1. `export interface XAdapter` en `packages/core/src/capabilities.ts`
2. `readonly x?: XAdapter` en `MessagingAdapter`, y reexportar el nombre desde `adapter.ts`
3. En el núcleo, un guardia y nada más:

<!-- setup: import { RelayKitError } from "@relaykit/core"; type XAdapter = { readonly x: string }; -->

```ts
class XOperations {
  private readonly context!: { readonly adapter: { readonly x?: XAdapter } };

  private get x(): XAdapter {
    const found = this.context.adapter.x;
    if (!found) throw new RelayKitError("NOT_SUPPORTED", "X no es algo que este homeserver tenga");
    return found;
  }
}
```

4. En cada adaptador, **una línea**: `readonly x: XAdapter = this;` — la clase ya tiene esos métodos, así que
   ya *es* esa forma.
5. `unavailable-adapter.ts` **no se toca**: la biblioteca dice que no por él.

### Escribir un adaptador nuevo

<!-- setup: import type { MessagingAdapter } from "@relaykit/core"; -->

```ts
export class MiAdapter implements Partial<MessagingAdapter> {
  // diecisiete métodos: entrar, registrarse, arrancar, parar, salir;
  // listar/crear/entrar/salir/invitar conversaciones;
  // listar mensajes, traer más, enviar; y quién es alguien.
}
```

Lo demás se añade cuando lo tengas, declarando la capacidad. Para saber si va bien:

```bash
node --test tests/adapter-contract.test.mjs   # la misma suite que cumple Matrix
```

### Añadir un campo a un modelo

1. `core/src/models/<asunto>.ts` — opcional (`?`) salvo que siempre exista
2. Que lo rellene **cada** adaptador: `in-memory` y `matrix-js`
3. Un test que lo lea de punta a punta

> Cuidado con el fallo que ya hemos tenido tres veces: **un campo que se escribe y no se puede leer**. Si
> añades `setX`, pregúntate quién hace `getX`. Pasó con reacciones, con presencia y con los rangos.

### Añadir una pantalla al ejemplo

1. Un archivo en `examples/web/src/app/`, un asunto
2. El marcado en `examples/web/index.html`
3. Armarlo en `app.ts`
4. Lógica pura en su propio archivo sin DOM: node ejecuta TypeScript, así que se testea desde el fuente
   (`tests/writing.test.mjs` lo hace)

---

## Cómo se comprueba, y cuándo hace falta cada cosa

| Comando | Qué prueba | Necesita |
|---|---|---|
| `npm run check` | formato, lint, tipos, build | nada |
| `npm run test:unit` | 680 tests contra el doble | nada |
| `npm run test:contract` | 100 tests, **el doble y Matrix a la vez** | `npm run matrix:up` |
| `npm run check:calls` | una llamada entre dos navegadores | Matrix + LiveKit |
| `npm run check:keys` | crear clave, desbloquear, verificar por emojis | Matrix |
| `npm run check:chat` | dos personas hablando en la aplicación | Matrix |
| `npm run smoke:*` | recorridos de punta a punta | Matrix |

**Nada de mocks del SDK.** Un test con un `MatrixClient` falso comprueba que escribiste lo que escribiste, y
codifica lo que *crees* que hace `matrix-js-sdk`. Lo que de verdad verifica el adaptador es hablar con un
homeserver: para eso está la suite de contrato, y CI la levanta.

Lo que sí se testea sin red es lo **puro**: mapeos, decisiones, formatos. Y ahí se usan objetos **reales** del
SDK (`new MatrixEvent({...})`), no imitaciones.

---

## Las reglas de la casa

- **TDD** para lógica no trivial: test en rojo, mínimo código, refactor.
- **Medir la cobertura antes de mover código.** Mover lo que no está cubierto es mover a ciegas.
- **Nada de casts.** Si algo viene del cable, se lee con `reading-content.ts`, no se afirma.
- **Guard clauses**, nada anidado. Condición con más de una parte → una `const` con nombre.
- **Un archivo, un asunto.** Por debajo de 300 líneas salvo que partirlo empeore la lectura — y entonces se
  escribe por qué.
- **Usa el SDK.** Antes de escribir algo, mira si `matrix-js-sdk` ya lo hace: el nombre de una sala, los
  nombres de membresía y la forma de un mensaje ya estaban ahí.
- **Todo en inglés en el código**: identificadores, comentarios y errores. El texto de pantalla del ejemplo va
  en español porque el diseño lo está.

---

## Trampas que ya nos han costado un rato

- **`messages.list` filtra los hilos; los eventos en vivo no lo hacían.** Una conversación con un hilo activo
  se llenaba de respuestas. Se filtra en los dos sitios.
- **`<form method="dialog">` se resetea al cerrarse.** Leer los campos en el evento `close` lee campos vacíos.
- **Esparcir una unión de TypeScript** da `never` a toda clave no compartida. Por eso los contenidos de mensaje
  se construyen enteros por nombre y no con los helpers del SDK.
- **`createConversationList().refresh()` no resuelve mientras el sync sigue trayendo cosas.** No lo esperes al
  arrancar.
- **Ir hacia atrás en el timeline puede devolver menos de lo que hay en pantalla** si la historia está fuera de
  alcance. Se junta, nunca se sustituye.
- **La cripto no está lista cuando `start({ waitForSync: false })` vuelve.** Las llamadas de cripto esperan.
- **La suite de contrato crea salas.** Ahora se sale de ellas al acabar; los `smoke:*` todavía no.

---

## Lo que queda por encima de 300 líneas, y por qué

| Archivo | Por qué |
|---|---|
| `in-memory-adapter.ts` (974) | Implementa el puerto entero. Partirlo son doce callbacks y peor lectura |
| `matrix-js-adapter.ts` (698) | Lo mismo: delega los 58 métodos que sí tiene |
| `client.ts` (<!-- lines: 723 -->723) | Es la superficie: <!-- operations: 156 -->156 operaciones a una línea. Una fachada grande no es una clase con muchas responsabilidades si no tiene lógica |
| `capabilities.ts` (453) | 22 interfaces de tipos. Una lista, no lógica |
| `outbox-operations.ts` (444) | Once referencias a estado compartido. Partirlo lo empeora |

Si vas a partir uno de estos, **mide la cobertura primero** y ten un motivo mejor que el número.

---

Ver también: [README.md](README.md) (qué hay), [API.md](API.md) (la superficie), [PIEZAS.md](PIEZAS.md) (qué
usa por debajo).

## Añadir un código de error

`RelayKitErrorCode` es API pública y la parte más cara de cambiar. La regla:

```
¿una aplicación haría algo DISTINTO por este fallo?
              │
       ┌──────┴──────┐
      sí             no
       │              │
  código propio   ADAPTER_ERROR + detail
```

No se añade un código porque Matrix tenga un `errcode` para eso. Se añade cuando alguien pintaría otra
pantalla. Mientras tanto vive como `ADAPTER_ERROR` con lo que dijo el servidor en `detail`, que es donde se
mira para decidir si merece ascender.

Dónde se traduce: `packages/matrix-js/src/matrix-errors.ts`, un solo sitio. Todo lo que sale del adaptador
pasa por `withTranslatedErrors`, así que nada crudo del SDK escapa. Lo prueban
`tests/one-kind-of-error.test.mjs` (con los fallos reales que devolvió Synapse) y el test de contrato
«refuses in this library's words», que provoca refusals de verdad contra el homeserver de desarrollo.

## Añadir un evento de diagnóstico

Al revés que los códigos de error, éstos **sí** se pueden quitar: son para leer en un log, no para pintar.
Por eso están en `diagnostics.ts` y no en `events.ts`, y por eso no salen por `client.on(...)`.

Dos reglas y ninguna más:

1. **Nada privado.** Ni cuerpos, ni títulos, ni nombres, ni direcciones, ni identificadores de persona. Un
   identificador de sala sí, porque no dice nada de lo que hay dentro. Lo comprueba un test.
2. **El código de error, nunca el mensaje.** `codeOf(error)` existe para eso. Un mensaje puede llevar
   cualquier cosa; un código es de una lista cerrada.

Se emite con `this.context.diagnostics.say(nombre, { ... })`, y el contexto se pasa como cualquier otra
dependencia. Si nadie está escuchando no se construye nada, así que no hace falta comprobarlo antes.

## Los números de este documento se comprueban solos

`npm run count:api` los cuenta del código y falla si este documento dice otra cosa. Está en CI.

Llegó a decir «ciento veintiséis operaciones» y «quinientas treinta y tres líneas» cuando ya eran otras, porque estaban escritos a mano: nadie se
da cuenta de que un número se ha quedado viejo. Ahora mismo: <!-- requiredOfAnAdapter: 17 -->17 métodos obligatorios en el
puerto, 22 capabilities, <!-- operations: 156 -->156 operaciones públicas y <!-- errorCodes: 17 -->17 códigos de error.
