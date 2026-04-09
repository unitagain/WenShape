export function getDesktopBridge() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.wenshapeDesktop || null;
}

export function isDesktopRuntime() {
  return Boolean(getDesktopBridge()?.isDesktop);
}

export function subscribeDesktopCommands(listener) {
  const bridge = getDesktopBridge();
  if (!bridge?.onCommand || typeof listener !== 'function') {
    return () => {};
  }

  return bridge.onCommand(listener);
}

export function subscribeDesktopDeepLinks(listener) {
  const bridge = getDesktopBridge();
  if (!bridge?.onDeepLink || typeof listener !== 'function') {
    return () => {};
  }

  return bridge.onDeepLink(listener);
}

export async function openDesktopLogsDirectory() {
  return getDesktopBridge()?.openLogsDirectory?.();
}

export async function openDesktopDataDirectory() {
  return getDesktopBridge()?.openDataDirectory?.();
}

export async function openDesktopRuntimeDirectory() {
  return getDesktopBridge()?.openRuntimeDirectory?.();
}

export async function openDesktopMainLog() {
  return getDesktopBridge()?.openMainLog?.();
}

export async function importDesktopTextFile() {
  return getDesktopBridge()?.importTextFile?.();
}

export async function chooseDesktopExportPath(options = {}) {
  return getDesktopBridge()?.chooseExportPath?.(options);
}

export async function revealDesktopPath(targetPath) {
  return getDesktopBridge()?.revealPath?.(targetPath);
}
