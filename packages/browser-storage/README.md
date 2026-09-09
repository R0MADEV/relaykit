# @relaykit/browser-storage

`IndexedDbStorage`: implementacion de `MessagingStorage` sobre IndexedDB con cifrado AES-GCM del contenido de
mensajes y de los adjuntos en cola, derivando la clave de un secreto por dispositivo.

```ts
import { IndexedDbStorage } from "@relaykit/browser-storage";

const storage = new IndexedDbStorage("relaykit-app", { encryptionSecret });
```
