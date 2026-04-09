const { contextBridge, ipcRenderer } = require("electron");
const process = require("node:process");

contextBridge.exposeInMainWorld("wenshapeDesktop", {
  isDesktop: true,
  platform: process.platform,
  getShellStatus() {
    return ipcRenderer.invoke("wenshape:get-shell-status");
  },
  getRuntimeInfo() {
    return ipcRenderer.invoke("wenshape:desktop-get-runtime-info");
  },
  onShellStatus(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("wenshape:shell-status", wrapped);
    return () => ipcRenderer.removeListener("wenshape:shell-status", wrapped);
  },
  onCommand(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("wenshape:desktop-command", wrapped);
    return () => ipcRenderer.removeListener("wenshape:desktop-command", wrapped);
  },
  onDeepLink(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("wenshape:deep-link", wrapped);
    return () => ipcRenderer.removeListener("wenshape:deep-link", wrapped);
  },
  openLogsDirectory() {
    return ipcRenderer.invoke("wenshape:desktop-open-logs-dir");
  },
  openDataDirectory() {
    return ipcRenderer.invoke("wenshape:desktop-open-data-dir");
  },
  openRuntimeDirectory() {
    return ipcRenderer.invoke("wenshape:desktop-open-runtime-dir");
  },
  openMainLog() {
    return ipcRenderer.invoke("wenshape:desktop-open-main-log");
  },
  importTextFile() {
    return ipcRenderer.invoke("wenshape:desktop-import-text-file");
  },
  chooseExportPath(options) {
    return ipcRenderer.invoke("wenshape:desktop-choose-export-path", options || {});
  },
  revealPath(targetPath) {
    return ipcRenderer.invoke("wenshape:desktop-reveal-path", { path: targetPath });
  }
});
