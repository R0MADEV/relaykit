# @relaykit/in-memory

`InMemoryAdapter` e `InMemoryStorage`: dobles de prueba que implementan los contratos de `@relaykit/core` sin
homeserver. Simulan eco de mensajes, typing, presencia, receipts, recovery y verificacion SAS.

```ts
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
```
