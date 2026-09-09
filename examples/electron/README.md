# Ejemplo Electron

Comprobacion automatica de que RelayKit funciona en un renderer de Electron: login, room cifrado, envio,
adjunto con descarga y storage IndexedDB cifrado.

```bash
npm run check --workspace=@relaykit/example-electron
```

Necesita un Synapse local con los usuarios de desarrollo. Sale con codigo 0 si todo funciona.

## Clave del storage local

RelayKit cifra su cache local con una clave derivada de `storageSecret`. Por defecto usa el access token, que
rota, asi que en Electron conviene una clave estable por dispositivo guardada en el llavero del sistema.

El proceso principal (`main.js`) la genera una vez con `crypto.randomBytes`, la cifra con `safeStorage` y la
guarda en `userData`. El renderer nunca ve Node ni el disco: la pide por un puente de `contextBridge`
(`preload.cjs`) y se la pasa al cliente:

```ts
const storageSecret = await window.relaykit.getStorageSecret();
const client = new MessagingClient({ storageSecret });
```

Si `safeStorage` no esta disponible, por ejemplo en un Linux sin llavero, la clave se guarda sin cifrar con
permisos `600`. La comprobacion escribe un marcador en cada ejecucion y lo lee en la siguiente, de modo que
`readMarkerFromPreviousRun` confirma que la clave sobrevive al reinicio.
