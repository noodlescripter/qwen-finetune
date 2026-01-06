"""Application configuration settings."""
import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class DatabaseConfig:
    """Database configuration."""
    path: str = "app.db"
    pool_size: int = 5
    timeout: int = 30


@dataclass
class ServerConfig:
    """Server configuration."""
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    workers: int = 4


@dataclass
class AuthConfig:
    """Authentication configuration."""
    session_duration_hours: int = 24
    max_login_attempts: int = 5
    lockout_duration_minutes: int = 15


@dataclass
class AppConfig:
    """Main application configuration."""
    database: DatabaseConfig
    server: ServerConfig
    auth: AuthConfig
    app_name: str = "MyApp"
    version: str = "1.0.0"


def load_config() -> AppConfig:
    """Load configuration from environment variables."""
    return AppConfig(
        database=DatabaseConfig(
            path=os.getenv("DB_PATH", "app.db"),
            pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
            timeout=int(os.getenv("DB_TIMEOUT", "30")),
        ),
        server=ServerConfig(
            host=os.getenv("SERVER_HOST", "0.0.0.0"),
            port=int(os.getenv("SERVER_PORT", "8000")),
            debug=os.getenv("DEBUG", "false").lower() == "true",
            workers=int(os.getenv("WORKERS", "4")),
        ),
        auth=AuthConfig(
            session_duration_hours=int(os.getenv("SESSION_HOURS", "24")),
            max_login_attempts=int(os.getenv("MAX_LOGIN_ATTEMPTS", "5")),
            lockout_duration_minutes=int(os.getenv("LOCKOUT_MINUTES", "15")),
        ),
        app_name=os.getenv("APP_NAME", "MyApp"),
        version=os.getenv("APP_VERSION", "1.0.0"),
    )


# Global config instance
config: Optional[AppConfig] = None


def get_config() -> AppConfig:
    """Get the global configuration instance."""
    global config
    if config is None:
        config = load_config()
    return config
