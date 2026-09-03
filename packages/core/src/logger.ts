/**
 * Structured local logging.
 *
 * Logs stay on the machine that produced them. Every payload is passed through
 * the redactor before it is emitted, so a stray `{ apiKey }` in a debug call
 * cannot leak into a terminal transcript or a CI log.
 */
import { redactDeep } from './redaction.ts';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface LogRecord {
  level: Exclude<LogLevel, 'silent'>;
  message: string;
  time: string;
  correlationId?: string;
  data?: Record<string, unknown>;
}

export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  level?: LogLevel;
  correlationId?: string;
  sink?: LogSink;
}

export const consoleSink: LogSink = (record) => {
  const prefix = `${record.time} ${record.level.toUpperCase().padEnd(5)}`;
  const scope = record.correlationId ? ` [${record.correlationId}]` : '';
  const data =
    record.data && Object.keys(record.data).length > 0 ? ` ${JSON.stringify(record.data)}` : '';
  const line = `${prefix}${scope} ${record.message}${data}`;
  if (record.level === 'error') console.error(line);
  else if (record.level === 'warn') console.warn(line);
  else console.log(line);
};

export class Logger {
  private readonly level: LogLevel;
  private readonly correlationId: string | undefined;
  private readonly sink: LogSink;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.correlationId = options.correlationId;
    this.sink = options.sink ?? consoleSink;
  }

  /** Derive a child logger that tags every record with a correlation id. */
  child(correlationId: string): Logger {
    return new Logger({ level: this.level, correlationId, sink: this.sink });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.emit('debug', message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.emit('info', message, data);
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.emit('warn', message, data);
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.emit('error', message, data);
  }

  private emit(
    level: Exclude<LogLevel, 'silent'>,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (RANK[level] < RANK[this.level]) return;
    const record: LogRecord = {
      level,
      message,
      time: new Date().toISOString(),
      ...(this.correlationId ? { correlationId: this.correlationId } : {}),
      ...(data ? { data: redactDeep(data) } : {}),
    };
    this.sink(record);
  }
}

/** Collects records in memory — used by tests and by the in-browser run view. */
export function memorySink(): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { sink: (record) => void records.push(record), records };
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  if (!value) return fallback;
  const normalised = value.toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(normalised)
    ? (normalised as LogLevel)
    : fallback;
}
