/**
 * Minimal pluggable logger.
 *
 * webjs doesn't pick pino/winston/bunyan for you. The default in prod emits
 * one JSON object per line to stdout — trivially ingestable by any log
 * aggregator. In dev, lines are plain text for readability.
 *
 * Apps can pass their own logger to `createRequestHandler({ logger })`.
 * Any object that implements `{ info, warn, error }` works.
 *
 * @typedef {{
 *   info: (msg: string, meta?: Record<string, unknown>) => void,
 *   warn: (msg: string, meta?: Record<string, unknown>) => void,
 *   error: (msg: string, meta?: Record<string, unknown>) => void,
 * }} Logger
 */

/**
 * @param {{ dev?: boolean }} [opts]
 * @returns {Logger}
 */
export function defaultLogger(opts = {}) {
  if (opts.dev) {
    return {
      info: (msg, meta) => console.log(meta ? `[webjs] ${msg}` : `[webjs] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[webjs] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[webjs] ${msg}`, meta ?? ''),
    };
  }
  const emit = (level, stream) => (msg, meta) => {
    const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...(meta || {}) });
    stream.write(line + '\n');
  };
  return {
    info: emit('info', process.stdout),
    warn: emit('warn', process.stderr),
    error: emit('error', process.stderr),
  };
}
