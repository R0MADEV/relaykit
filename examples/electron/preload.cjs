const { contextBridge, ipcRenderer } = require("electron");

// The renderer never sees Node or the file system: it only asks the main process for the device secret.
contextBridge.exposeInMainWorld("relaykit", {
  getStorageSecret: () => ipcRenderer.invoke("relaykit:storage-secret")
});
