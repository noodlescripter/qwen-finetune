"""Main application entry point."""
from config import get_config
from utils.logger import get_logger
from utils.database import create_connection
from models.user import UserRepository
from services.auth import AuthService


logger = get_logger("main")


def init_database(db_connection) -> None:
    """Initialize database tables."""
    create_tables_query = """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        )
    """
    with db_connection.get_cursor() as cursor:
        cursor.execute(create_tables_query)
    logger.info("Database initialized")


def create_app():
    """Create and configure the application."""
    config = get_config()
    logger.info(f"Starting {config.app_name} v{config.version}")

    # Initialize database
    db = create_connection(config.database.path)
    init_database(db)

    # Initialize repositories
    user_repo = UserRepository(db)

    # Initialize services
    auth_service = AuthService(user_repo)

    return {
        "config": config,
        "db": db,
        "user_repo": user_repo,
        "auth_service": auth_service,
    }


def main():
    """Main entry point."""
    app = create_app()
    config = app["config"]

    logger.info(f"Server running on {config.server.host}:{config.server.port}")

    # Example: Create a test user
    user_repo = app["user_repo"]
    try:
        user = user_repo.create_user(
            username="testuser",
            email="test@example.com",
            password="securepassword123"
        )
        logger.info(f"Created test user: {user.username}")
    except Exception as e:
        logger.debug(f"User may already exist: {e}")

    # Example: Authenticate
    auth_service = app["auth_service"]
    try:
        token = auth_service.login("testuser", "securepassword123")
        logger.info(f"Login successful, token: {token[:20]}...")
    except Exception as e:
        logger.error(f"Login failed: {e}")


if __name__ == "__main__":
    main()
