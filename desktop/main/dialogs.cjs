const fs = require("node:fs");
const path = require("node:path");

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

async function openPath(targetPath) {
  const { shell } = require("electron");

  if (!targetPath) {
    return false;
  }

  await shell.openPath(targetPath);
  return true;
}

async function revealPath(targetPath) {
  const { shell } = require("electron");

  if (!targetPath) {
    return false;
  }

  shell.showItemInFolder(targetPath);
  return true;
}

async function pickImportTextFile(options = {}) {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog(options.browserWindow || undefined, {
    title: "Import Text File",
    properties: ["openFile"],
    filters: [
      { name: "Text files", extensions: ["txt", "md", "markdown", "json", "log"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  const [filePath] = result.filePaths || [];
  if (result.canceled || !filePath) {
    return { canceled: true };
  }

  const stats = await fs.promises.stat(filePath);
  if (stats.size > MAX_IMPORT_BYTES) {
    throw new Error(`Imported file is too large. Maximum supported size is ${MAX_IMPORT_BYTES} bytes.`);
  }

  const content = await fs.promises.readFile(filePath, "utf8");
  return {
    canceled: false,
    filePath,
    name: path.basename(filePath),
    size: stats.size,
    content,
    encoding: "utf8"
  };
}

async function pickExportFilePath(options = {}) {
  const { app, dialog } = require("electron");

  const defaultFileName = String(options.defaultFileName || "wenshape-export.txt");
  const defaultDir = options.defaultDirectory || app.getPath("documents");
  const defaultPath = path.join(defaultDir, defaultFileName);

  const result = await dialog.showSaveDialog(options.browserWindow || undefined, {
    title: "Choose Export Target",
    defaultPath,
    buttonLabel: "Choose Location",
    filters: [
      { name: "Text files", extensions: ["txt"] },
      { name: "Markdown files", extensions: ["md"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  return {
    canceled: false,
    filePath: result.filePath
  };
}

function registerDesktopDialogIpc({ ipcMain, getWindow, getDesktopPaths, getShellMetadata }) {
  ipcMain.handle("wenshape:desktop-open-logs-dir", async () => {
    const paths = getDesktopPaths();
    return openPath(paths?.logsDir);
  });

  ipcMain.handle("wenshape:desktop-open-data-dir", async () => {
    const paths = getDesktopPaths();
    return openPath(paths?.dataDir);
  });

  ipcMain.handle("wenshape:desktop-open-runtime-dir", async () => {
    const paths = getDesktopPaths();
    return openPath(paths?.runtimeRoot);
  });

  ipcMain.handle("wenshape:desktop-open-main-log", async () => {
    const paths = getDesktopPaths();
    return revealPath(paths?.mainLogPath);
  });

  ipcMain.handle("wenshape:desktop-import-text-file", async () => {
    return pickImportTextFile({
      browserWindow: getWindow()
    });
  });

  ipcMain.handle("wenshape:desktop-choose-export-path", async (_event, payload = {}) => {
    return pickExportFilePath({
      browserWindow: getWindow(),
      defaultFileName: payload.defaultFileName,
      defaultDirectory: payload.defaultDirectory
    });
  });

  ipcMain.handle("wenshape:desktop-reveal-path", async (_event, payload = {}) => {
    return revealPath(payload.path);
  });

  ipcMain.handle("wenshape:desktop-get-runtime-info", async () => {
    const paths = getDesktopPaths();
    const metadata = getShellMetadata();
    return {
      isDesktop: true,
      isDev: metadata.isDev,
      frontendDevUrl: metadata.frontendDevUrl,
      runtimePaths: {
        runtimeRoot: paths?.runtimeRoot || null,
        configDir: paths?.configDir || null,
        dataDir: paths?.dataDir || null,
        logsDir: paths?.logsDir || null,
        cacheDir: paths?.cacheDir || null,
        crashDir: paths?.crashDir || null,
        mainLogPath: paths?.mainLogPath || null
      }
    };
  });
}

module.exports = {
  openPath,
  pickExportFilePath,
  pickImportTextFile,
  registerDesktopDialogIpc,
  revealPath
};
