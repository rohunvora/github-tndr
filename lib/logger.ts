// Structured logging for Vercel
// All logs are JSON for easy searching in Vercel dashboard

type LogLevel = 'info' | 'error' | 'debug';

interface LogEntry {
  ts: string;
  level: LogLevel;
  ctx: string;
  msg: string;
  data?: Record<string, unknown>;
  err?: string;
  stack?: string;
}

export function log(level: LogLevel, ctx: string, msg: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    ctx,
    msg,
    data,
  };
  console.log(JSON.stringify(entry));
}

export function logError(ctx: string, error: unknown, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level: 'error',
    ctx,
    msg: error instanceof Error ? error.message : String(error),
    err: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    data,
  };
  console.error(JSON.stringify(entry));
}

// Convenience wrappers
export const info = (ctx: string, msg: string, data?: Record<string, unknown>) => log('info', ctx, msg, data);
export const debug = (ctx: string, msg: string, data?: Record<string, unknown>) => log('debug', ctx, msg, data);
export const error = (ctx: string, err: unknown, data?: Record<string, unknown>) => logError(ctx, err, data);

