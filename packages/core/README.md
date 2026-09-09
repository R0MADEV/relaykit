# @relaykit/core

Contratos publicos y runtime de `MessagingClient` de RelayKit. No depende de Matrix: los adapters implementan
`MessagingAdapter` y `MessagingStorage`.

```ts
import { MessagingClient } from "@relaykit/core";
```

Para navegador y Electron usa `@relaykit/web`, que ya integra el adapter Matrix y el storage cifrado.
Documentacion completa en el README del repositorio.
