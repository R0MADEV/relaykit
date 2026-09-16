# @relaykit/core

El contrato y el runtime de RelayKit. **No depende de nada**: ni de Matrix, ni de LiveKit, ni de IndexedDB. Todo
lo que habla con el mundo entra por un puerto.

```ts
import { MessagingClient } from "@relaykit/core";
```

## Lo que hay dentro

- **`MessagingClient`** — las 156 operaciones de la biblioteca, en 16 grupos (`conversations`, `messages`,
  `calls`, `account`, `crypto`…). Es lo único que una aplicación usa.
- **`MessagingAdapter`** — lo que hay que implementar para hablar con un servidor: 17 métodos obligatorios y 22
  capacidades opcionales (`CallingAdapter`, `PollsAdapter`, `CryptoAdapter`…). Pedir algo que el adaptador no
  trae devuelve un `RelayKitError` con código `NOT_SUPPORTED`, no un fallo raro.
- **`MessagingStorage`** — lo que hay que implementar para guardar una copia local.
- **`RelayKitError`** — un solo tipo de error con 17 códigos estables. El código es lo que se mira; el texto del
  servidor nunca sale a la pantalla.
- **`ClientEvents`** — lo que la biblioteca avisa sola.
- **Diagnósticos** — `DiagnosticEvent`, para ver qué tarda y qué falla sin instrumentar nada.

## Implementaciones

`@relaykit/matrix-js` habla Matrix; `@relaykit/in-memory` es un doble para tests que no toca la red;
`@relaykit/browser-storage` guarda la copia local cifrada; `@relaykit/web` junta los tres. La documentación
completa está en el README del repositorio y en `API.md`.
