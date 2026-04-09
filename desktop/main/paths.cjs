const fs = require("node:fs");
const path = require("node:path");

const { getShellMetadata } = require("./runtime.cjs");

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function directoryHasEntries(dirPath) {
  return fs.existsSync(dirPath) && fs.readdirSync(dirPath).length > 0;
}

function seedDesktopDataDir(paths) {
  if (process.env.WENSHAPE_DESKTOP_SKIP_DATA_MIGRATION === "1") {
    return null;
  }

  if (directoryHasEntries(paths.dataDir)) {
    return null;
  }

  const metadata = getShellMetadata();
  const legacyDataDir = path.join(metadata.repoRoot, "data");
  if (!directoryHasEntries(legacyDataDir)) {
    return null;
  }

  fs.cpSync(legacyDataDir, paths.dataDir, {
    recursive: true,
    force: false,
    errorOnExist: false
  });

  return legacyDataDir;
}

function resolveDesktopPaths(options = {}) {
  const metadata = getShellMetadata();
  const manifestPaths = metadata.manifest.paths || {};
  const runtimeRoot = path.resolve(
    String(
      process.env.WENSHAPE_DESKTOP_RUNTIME_ROOT
      || options.runtimeRoot
      || (options.isPackaged ? options.userDataDir : path.join(metadata.repoRoot, ".desktop-runtime"))
    )
  );

  const configDir = path.join(runtimeRoot, manifestPaths.configDirName || "config");
  const dataDir = path.join(runtimeRoot, manifestPaths.dataDirName || "data");
  const logsDir = path.join(runtimeRoot, manifestPaths.logsDirName || "logs");
  const cacheDir = path.join(runtimeRoot, manifestPaths.cacheDirName || "cache");
  const crashDir = path.join(logsDir, manifestPaths.crashDirName || "crashes");
  const sidecarDir = path.join(runtimeRoot, "sidecar");

  return {
    runtimeRoot,
    configDir,
    dataDir,
    logsDir,
    cacheDir,
    crashDir,
    sidecarDir,
    mainLogPath: path.join(logsDir, "desktop-main.log")
  };
}

function ensureDesktopPaths(paths) {
  ensureDirectory(paths.runtimeRoot);
  ensureDirectory(paths.configDir);
  ensureDirectory(paths.dataDir);
  ensureDirectory(paths.logsDir);
  ensureDirectory(paths.cacheDir);
  ensureDirectory(paths.crashDir);
  paths.seededDataFrom = seedDesktopDataDir(paths);
  return paths;
}

function applyElectronPathOverrides(app, paths) {
  app.setPath("sessionData", paths.cacheDir);
  app.setPath("crashDumps", paths.crashDir);
  app.setAppLogsPath(paths.logsDir);
}

module.exports = {
  applyElectronPathOverrides,
  ensureDesktopPaths,
  resolveDesktopPaths
};
