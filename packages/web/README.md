# @relaykit/web

RelayKit para navegador y Electron: junta `@relaykit/core`, el adaptador de Matrix y la copia local cifrada en
IndexedDB, y reexporta todos los tipos públicos. Es el único paquete que una aplicación necesita instalar.

```ts
import { MessagingClient } from "@relaykit/web";

const client = new MessagingClient({ session });
await client.start();
```

## Configuración

Además de lo de `@relaykit/core`:

- `matrix` — opciones del adaptador (`initialSyncLimit`, `conversationWindow`, `storeName`…).
- `storageSecret` — secreto del que se deriva la clave de la copia local. Por defecto, uno hecho una vez para
  este navegador y guardado ahí, de modo que volver a entrar no deja ilegible lo de ayer.
- `storagePassphrase` — una contraseña que teclea la persona, en lugar de `storageSecret`, para una copia que
  tiene que aguantar que alguien tenga el dispositivo en la mano. Va por una derivación lenta con sal, no por
  el digest único que basta para un secreto que ya es aleatorio.
- `adapter` — otro adaptador, para pruebas.

## Lo que hace por su cuenta

**La copia local lleva el nombre de quien la abrió.** `createBrowserStoreName` le pone detrás el identificador
del usuario, porque un nombre elegido por la aplicación a secas significa que todas las cuentas que entren en
este navegador comparten una base de datos: las conversaciones de una persona al alcance de la siguiente, y
nada que haga sospecharlo.

**Y cambia de copia sola cuando cambia quien está dentro.** Entrar, registrarse, entrar como invitado, volver de
un proveedor de identidad, renovar el token o salir: todo pasa por un mismo sitio (`session.changed`), que
cierra la base de datos anterior y abre la de quien esté ahora. Una copia local no puede quedarse en manos de
quien ya no está dentro.
