# @relaykit/matrix-js

`MatrixJsAdapter`: la implementación de `MessagingAdapter` sobre [matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk).
Es el único paquete que sabe qué es una sala, un evento de estado o un `errcode`.

```ts
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const adapter = new MatrixJsAdapter({
  // Cuántos mensajes trae el primer sync de cada conversación.
  initialSyncLimit: 20,
  // Cuántas conversaciones pide de golpe, en lugar de todas.
  conversationWindow: 50,
  // Nombre del almacén de matrix-js-sdk en IndexedDB.
  storeName: "relaykit-matrix",
  // Para llamadas de más de dos: dónde está el servicio de conferencia.
  conferenceServiceUrl: "https://…"
});
```

Lo que traduce, además de los datos: **los errores**. Ningún texto del homeserver sale de aquí — 17 `errcode`
de Matrix se convierten en los 16 códigos de `RelayKitError`, y lo que no reconoce cae al código que le
corresponde por su estado HTTP.
