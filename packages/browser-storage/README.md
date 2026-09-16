# @relaykit/browser-storage

`IndexedDbStorage`: la copia local de RelayKit sobre IndexedDB. Implementa `MessagingStorage` de
`@relaykit/core`, así que no sabe nada de Matrix.

## Qué guarda

Seis almacenes: `conversations`, `messages`, `outbox`, `drafts`, `profiles` y `metadata`. Dos de ellos no son
caché: los borradores y la cola de envío solo existen aquí, y perderlos es perder lo que alguien escribió. El
resto se reconstruye solo desde el servidor, con una excepción que importa: en una conversación cifrada el
servidor solo tiene el cifrado, así que esta copia es la única que puede volver a enseñar lo que se dijo.

## Cómo se cierra

Todo lo guardado va cifrado con AES-GCM menos lo que hace falta para encontrarlo: de un mensaje se dejan en
claro `id`, `conversationId` y `status`, y el resto va sellado en un sobre. Es una lista blanca, de modo que un
campo nuevo del modelo queda protegido sin que nadie se acuerde de añadirlo.

La clave se deriva de una de estas dos cosas:

<!-- setup: declare const encryptionSecret: string; declare const typed: string; declare const salt: string; -->

```ts
import { IndexedDbStorage } from "@relaykit/browser-storage";

// Un secreto que ya es aleatorio —un secreto de dispositivo, un token—: basta un digest.
const conUnSecreto = new IndexedDbStorage("relaykit-app", { encryptionSecret });

// O algo que una persona ha tecleado: es adivinable, así que la derivación tiene que ser lenta.
// PBKDF2-HMAC-SHA256, 600.000 vueltas. La sal no es secreta y se guarda al lado de los datos; sin ella la
// misma contraseña daría la misma clave en todos los dispositivos y un solo cálculo previo los abriría todos.
const conUnaContraseña = new IndexedDbStorage("relaykit-app", { passphrase: { typed, salt } });
```

## Cambiar la clave

<!-- setup: declare const storage: import("@relaykit/browser-storage").IndexedDbStorage; declare const nuevaClave: string; -->

```ts
await storage.rekey(nuevaClave);                          // conserva lo que no se pueda abrir
await storage.rekey(nuevaClave, { dropUnreadable: true }); // tira lo que no se abra
const how = await storage.howItIsLocked();                // { kdf, version, iterations, salt }
```

`rekey` lee y vuelve a sellar todo en memoria, y solo entonces escribe, todo dentro de una transacción: la base
de datos queda entera bajo la clave nueva o exactamente como estaba. Y la clave en memoria se cambia después de
que la escritura haya terminado, no antes. Por defecto conserva lo que no ha podido abrir, porque una
contraseña equivocada y unos datos ilegibles se parecen demasiado, y para una cola de envío que todavía no ha
llegado a ningún servidor esa es la única copia.

`howItIsLocked` contesta cómo se hizo la clave que rige, tal y como se escribió junto a los datos: una versión
futura que suba el coste de la derivación puede así abrir una copia hecha hoy.
