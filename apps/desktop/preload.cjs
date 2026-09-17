const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "desktop",
  Object.freeze({
    copy: (text) => ipcRenderer.invoke("copy-text", text),
    notify: (title, body) => ipcRenderer.invoke("notify", title, body),
  }),
);
