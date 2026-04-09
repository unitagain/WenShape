const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

let installedLogger = null;

function createLine(level, args) {
  return `${new Date().toISOString()} level=${level} ${util.format(...args)}`;
}

function appendLine(stream, line) {
  if (!stream || stream.destroyed || stream.closed || !stream.writable) {
    return;
  }

  try {
    stream.write(`${line}\n`);
  } catch (_error) {
  }
}

function installMainLogger(options = {}) {
  if (installedLogger) {
    return installedLogger;
  }

  const logFilePath = path.resolve(String(options.logFilePath));
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

  const stream = fs.createWriteStream(logFilePath, {
    flags: "a",
    encoding: "utf8"
  });

  function write(level, args) {
    appendLine(stream, createLine(level, args));
  }

  console.debug = (...args) => write("DEBUG", args);
  console.info = (...args) => write("INFO", args);
  console.log = (...args) => write("INFO", args);
  console.warn = (...args) => write("WARN", args);
  console.error = (...args) => write("ERROR", args);

  process.on("uncaughtException", (error) => {
    appendLine(stream, createLine("ERROR", ["[desktop-main] uncaughtException", error]));
  });

  process.on("unhandledRejection", (reason) => {
    appendLine(stream, createLine("ERROR", ["[desktop-main] unhandledRejection", reason]));
  });

  installedLogger = {
    logFilePath,
    async close() {
      if (stream.closed || stream.destroyed) {
        return;
      }
      await new Promise((resolve) => stream.end(resolve));
    }
  };

  console.info(`[desktop-main] logging initialized -> ${logFilePath}`);
  return installedLogger;
}

module.exports = {
  installMainLogger
};
