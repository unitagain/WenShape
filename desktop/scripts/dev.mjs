import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..");
const frontendRoot = join(repoRoot, "frontend");
const manifestPath = join(desktopRoot, "config", "shell.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const frontendPort = Number.parseInt(
  String(process.env.WENSHAPE_FRONTEND_PORT || process.env.VITE_DEV_PORT || 3000),
  10
) || 3000;
const frontendUrl = process.env.WENSHAPE_DESKTOP_FRONTEND_URL || `http://127.0.0.1:${frontendPort}`;

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function startProcess(command, args, options = {}) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command, ...args], {
      stdio: "inherit",
      windowsHide: false,
      ...options
    });
  }

  return spawn(command, args, {
    stdio: "inherit",
    windowsHide: false,
    ...options
  });
}

async function waitForUrl(url, timeoutMs = 60000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }

  throw new Error(`frontend dev server did not become ready in time: ${url}`);
}

const frontendProcess = startProcess(
  npmCommand(),
  ["run", "dev"],
  {
    cwd: frontendRoot,
    env: {
      ...process.env,
      VITE_DEV_PORT: String(frontendPort),
      WENSHAPE_FRONTEND_PORT: String(frontendPort)
    }
  }
);

let shellProcess = null;

function shutdown() {
  if (shellProcess && !shellProcess.killed) {
    shellProcess.kill("SIGTERM");
  }

  if (frontendProcess && !frontendProcess.killed) {
    frontendProcess.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

frontendProcess.on("exit", (code) => {
  if (shellProcess && !shellProcess.killed) {
    shellProcess.kill("SIGTERM");
  }
  process.exit(code ?? 0);
});

try {
  console.log(`[desktop-dev] starting frontend dev server: ${frontendUrl}`);
  await waitForUrl(frontendUrl, 90000);
  console.log("[desktop-dev] frontend dev server is ready");

  shellProcess = startProcess(
    npmCommand(),
    ["run", "start:shell"],
    {
      cwd: desktopRoot,
      env: {
        ...process.env,
        WENSHAPE_DESKTOP_DEV: "1",
        WENSHAPE_DESKTOP_FRONTEND_URL: frontendUrl,
        WENSHAPE_DESKTOP_RELEASE_CHANNEL: manifest.releaseChannels?.[0] || "dev"
      }
    }
  );

  shellProcess.on("exit", (code) => {
    if (frontendProcess && !frontendProcess.killed) {
      frontendProcess.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error("[desktop-dev] startup failed:", error);
  shutdown();
  process.exit(1);
}
