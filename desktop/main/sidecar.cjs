const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const process = require("node:process");

const { getShellMetadata } = require("./runtime.cjs");

function onceChildExit(child) {
  return new Promise((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`sidecar exited before ready (code=${code}, signal=${signal || "none"})`));
    });
    child.once("error", (error) => {
      reject(error);
    });
  });
}

function pickFreePort(host, preferred, maxTries = 30) {
  const base = Number.parseInt(String(preferred || 0), 10) || 8000;
  let current = base;

  return new Promise((resolve, reject) => {
    const tryNext = () => {
      if (current >= base + maxTries) {
        reject(new Error(`unable to allocate sidecar port from base ${base}`));
        return;
      }

      const server = net.createServer();
      server.unref();
      server.once("error", () => {
        current += 1;
        tryNext();
      });
      server.listen({ host, port: current }, () => {
        const address = server.address();
        const selectedPort = typeof address === "object" && address ? address.port : current;
        server.close(() => resolve(selectedPort));
      });
    };

    tryNext();
  });
}

function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(`${url}/health`, (response) => {
        if (response.statusCode === 200) {
          response.resume();
          resolve();
          return;
        }

        response.resume();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`sidecar health check timed out: ${url}/health`));
          return;
        }

        setTimeout(tick, 1000);
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`sidecar health check timed out: ${url}/health`));
          return;
        }

        setTimeout(tick, 1000);
      });
    };

    tick();
  });
}

function choosePythonCommand() {
  if (process.env.WENSHAPE_DESKTOP_PYTHON) {
    return process.env.WENSHAPE_DESKTOP_PYTHON;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function resolvePackagedSidecarExecutable(paths) {
  const executableName = process.platform === "win32" ? "WenShapeBackend.exe" : "WenShapeBackend";
  const candidates = [
    process.env.WENSHAPE_DESKTOP_SIDECAR_EXECUTABLE,
    process.resourcesPath ? path.join(process.resourcesPath, "sidecar", executableName) : null,
    paths?.sidecarDir ? path.join(paths.sidecarDir, executableName) : null,
    paths?.runtimeRoot ? path.join(paths.runtimeRoot, "sidecar", executableName) : null
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function createDesktopEnv({ port, token, paths }) {
  return {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: paths?.dataDir || process.env.DATA_DIR,
    WENSHAPE_BACKEND_PORT: String(port),
    WENSHAPE_AUTO_PORT: "0",
    WENSHAPE_DESKTOP_SESSION_TOKEN: token,
    WENSHAPE_DESKTOP_SHELL: "electron",
    WENSHAPE_DESKTOP_LOG_DIR: paths?.logsDir || "",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8"
  };
}

function attachLogging(child, label) {
  const writer = (stream, method) => {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (!text) {
        return;
      }
      console[method](`[${label}] ${text}`);
    });
  };

  writer(child.stdout, "log");
  writer(child.stderr, "error");
}

async function startSidecar(options = {}) {
  const metadata = getShellMetadata();
  const host = "127.0.0.1";
  const preferredPort = process.env.WENSHAPE_BACKEND_PORT || process.env.PORT || 8000;
  const port = await pickFreePort(host, preferredPort);
  const token = crypto.randomUUID();
  const baseUrl = `http://${host}:${port}`;

  let command;
  let args;
  let cwd;

  if (options.isPackaged) {
    const executable = resolvePackagedSidecarExecutable(options.paths);
    if (!executable) {
      throw new Error("packaged sidecar executable was not found");
    }
    command = executable;
    args = [];
    cwd = path.dirname(executable);
  } else {
    command = choosePythonCommand();
    args = ["-m", "app.main"];
    cwd = path.join(metadata.repoRoot, "backend");
  }

  const child = spawn(command, args, {
    cwd,
    env: createDesktopEnv({ port, token, paths: options.paths }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  attachLogging(child, "wenshape-sidecar");

  await Promise.race([
    waitForHealth(baseUrl, options.startupTimeoutMs || 45000),
    onceChildExit(child)
  ]);

  return {
    child,
    host,
    port,
    baseUrl,
    token,
    expectedExit: false,
    startedAt: new Date().toISOString()
  };
}

function stopSidecar(state, options = {}) {
  return new Promise((resolve) => {
    if (!state?.child || state.child.killed) {
      resolve();
      return;
    }

    const child = state.child;
    state.expectedExit = true;

    const timeout = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, options.forceAfterMs || 5000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

module.exports = {
  startSidecar,
  stopSidecar
};
