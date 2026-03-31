/**
 * Unified logger for the frontend.
 * In production builds, only warnings and errors are output.
 * In development, all levels are output.
 */

const isDev = typeof import.meta !=== 'undefined' && import.meta.env?.DEV;

const noop = () => {};

const logger = {
  debug: isDev ? (...args) => console.debug('[WenShape]', ...args) : noop,
  info: isDev ? (...args) => console.info('[WenShape]', ...args) : noop,
  warn: (...args) => console.warn('[WenShape]', ...args),
  error: (...args) => console.error('[WenShape]', ...args),
};

export default logger;
