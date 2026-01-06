/**
 * Custom logging utility for the application.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export class AppLogger {
  private name: string;
  private minLevel: LogLevel;
  private logHistory: LogEntry[] = [];

  private static levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(name: string, minLevel: LogLevel = 'info') {
    this.name = name;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return AppLogger.levelPriority[level] >= AppLogger.levelPriority[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: `[${this.name}] ${message}`,
      context,
    };
    this.logHistory.push(entry);
    return entry;
  }

  private output(entry: LogEntry): void {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const output = `[${entry.timestamp}] ${entry.level.toUpperCase()} - ${entry.message}${contextStr}`;

    switch (entry.level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'debug':
        console.debug(output);
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      this.output(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      this.output(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      this.output(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      this.output(this.formatMessage('error', message, context));
    }
  }

  getHistory(): LogEntry[] {
    return [...this.logHistory];
  }

  clearHistory(): void {
    this.logHistory = [];
  }
}

export function getLogger(name: string, minLevel?: LogLevel): AppLogger {
  return new AppLogger(name, minLevel);
}
