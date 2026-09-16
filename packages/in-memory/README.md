# @relaykit/in-memory

`InMemoryAdapter`: un `MessagingAdapter` completo que vive en memoria. No abre una conexión, no toca IndexedDB
y no necesita un homeserver, así que es con lo que se prueba una aplicación construida sobre RelayKit.

```ts
import { InMemoryAdapter } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const client = new MessagingClient({
  adapter: new InMemoryAdapter({
    conversations: [{ id: "!sala", participantIds: ["@alice:local", "@bob:local"] }],
    // Cuántos mensajes da leer una conversación, los más nuevos al final. Sin esto, todos.
    showAtMost: 20
  })
});
```

Trae también métodos que solo existen para una prueba —hacer que llegue un mensaje, que alguien llame a la
puerta, que un envío falle— y son los que permiten comprobar qué hace una pantalla ante algo que en un servidor
de verdad cuesta provocar. Los 790 tests unitarios de este repositorio corren contra este doble, y los 123 de
contrato corren los mismos casos contra él y contra un Synapse real, que es lo que impide que el doble se
aparte de lo que hace Matrix.
