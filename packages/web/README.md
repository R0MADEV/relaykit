# @relaykit/web

SDK de mensajeria headless para navegador y Electron. Reune `@relaykit/core`, el adapter Matrix y el storage
IndexedDB cifrado, y reexporta todos los tipos publicos.

```ts
import { MessagingClient } from "@relaykit/web";

const client = new MessagingClient({ session, storageSecret });
await client.start();
```

Documentacion completa en el README del repositorio.
