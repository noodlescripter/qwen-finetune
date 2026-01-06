/**
 * Application configuration management.
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  poolSize: number;
  ssl: boolean;
}

export interface ServerConfig {
  host: string;
  port: number;
  cors: {
    enabled: boolean;
    origins: string[];
  };
}

export interface AuthConfig {
  jwtSecret: string;
  tokenExpirationMs: number;
  refreshTokenExpirationMs: number;
  bcryptRounds: number;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
  outputFile?: string;
}

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  appName: string;
  version: string;
  database: DatabaseConfig;
  server: ServerConfig;
  auth: AuthConfig;
  logging: LoggingConfig;
}

function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

function getEnvArray(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.split(',').map((s) => s.trim());
}

export function loadConfig(): AppConfig {
  return {
    env: getEnvString('NODE_ENV', 'development') as AppConfig['env'],
    appName: getEnvString('APP_NAME', 'MyApp'),
    version: getEnvString('APP_VERSION', '1.0.0'),

    database: {
      host: getEnvString('DB_HOST', 'localhost'),
      port: getEnvNumber('DB_PORT', 5432),
      database: getEnvString('DB_NAME', 'app'),
      username: getEnvString('DB_USER', 'postgres'),
      password: getEnvString('DB_PASSWORD', ''),
      poolSize: getEnvNumber('DB_POOL_SIZE', 10),
      ssl: getEnvBoolean('DB_SSL', false),
    },

    server: {
      host: getEnvString('SERVER_HOST', '0.0.0.0'),
      port: getEnvNumber('SERVER_PORT', 3000),
      cors: {
        enabled: getEnvBoolean('CORS_ENABLED', true),
        origins: getEnvArray('CORS_ORIGINS', ['http://localhost:3000']),
      },
    },

    auth: {
      jwtSecret: getEnvString('JWT_SECRET', 'change-me-in-production'),
      tokenExpirationMs: getEnvNumber('TOKEN_EXPIRATION_MS', 15 * 60 * 1000),
      refreshTokenExpirationMs: getEnvNumber('REFRESH_TOKEN_EXPIRATION_MS', 7 * 24 * 60 * 60 * 1000),
      bcryptRounds: getEnvNumber('BCRYPT_ROUNDS', 10),
    },

    logging: {
      level: getEnvString('LOG_LEVEL', 'info') as LoggingConfig['level'],
      format: getEnvString('LOG_FORMAT', 'json') as LoggingConfig['format'],
      outputFile: process.env.LOG_FILE,
    },
  };
}

let configInstance: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}
