const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cashmere", {
  state: () => ipcRenderer.invoke("state"),
  saveDb: (db) => ipcRenderer.invoke("db:save", db),
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  revealFolder: () => ipcRenderer.invoke("folder:reveal"),
  exportCsv: (name, text) => ipcRenderer.invoke("export:csv", { name, text }),
});
