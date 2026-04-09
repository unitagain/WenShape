const path = require("node:path");

function parseDeepLinkUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const payload = {
      url: targetUrl,
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.host,
      pathname: parsed.pathname,
      search: parsed.search,
      query: Object.fromEntries(parsed.searchParams.entries()),
      route: null
    };

    if (parsed.host === "project") {
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments[0]) {
        payload.route = `/project/${segments[0]}/session`;
      }
    } else if (parsed.host === "open") {
      const nextPath = parsed.searchParams.get("path");
      if (nextPath && nextPath.startsWith("/")) {
        payload.route = nextPath;
      }
    }

    return payload;
  } catch (_error) {
    return {
      url: targetUrl,
      protocol: null,
      host: null,
      pathname: null,
      search: null,
      query: {},
      route: null
    };
  }
}

function findProtocolUrl(argv, protocolName) {
  return (argv || []).find((arg) => String(arg || "").startsWith(`${protocolName}://`)) || null;
}

function createProtocolBridge(options = {}) {
  const pending = [];
  const protocolName = options.protocolName || "wenshape";

  function dispatch(targetUrl, source) {
    const payload = {
      ...parseDeepLinkUrl(targetUrl),
      source
    };

    if (!options.emit(payload)) {
      pending.push(payload);
    }
  }

  function flush() {
    while (pending.length > 0) {
      const payload = pending.shift();
      if (!options.emit(payload)) {
        pending.unshift(payload);
        return false;
      }
    }
    return true;
  }

  function register() {
    try {
      if (process.defaultApp && process.argv[1]) {
        options.app.setAsDefaultProtocolClient(
          protocolName,
          process.execPath,
          [path.resolve(process.argv[1])]
        );
        return;
      }

      options.app.setAsDefaultProtocolClient(protocolName);
    } catch (error) {
      options.log?.warn?.("[desktop-main] protocol registration failed", error);
    }
  }

  function handleOpenUrl(targetUrl, source = "system") {
    if (!targetUrl) {
      return;
    }

    options.showWindow?.();
    dispatch(targetUrl, source);
  }

  function handleSecondInstance(argv) {
    const targetUrl = findProtocolUrl(argv, protocolName);
    if (!targetUrl) {
      return false;
    }

    handleOpenUrl(targetUrl, "second-instance");
    return true;
  }

  return {
    flush,
    handleOpenUrl,
    handleSecondInstance,
    register
  };
}

module.exports = {
  createProtocolBridge,
  findProtocolUrl,
  parseDeepLinkUrl
};
