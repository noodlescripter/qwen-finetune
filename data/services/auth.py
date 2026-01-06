"""Authentication service for handling user login and sessions."""
from datetime import datetime, timedelta
from typing import Optional
import secrets

from models.user import User, UserRepository
from utils.logger import get_logger


logger = get_logger("auth_service")


class AuthenticationError(Exception):
    """Raised when authentication fails."""
    pass


class Session:
    """Represents an active user session."""

    def __init__(self, user_id: int, token: str, expires_at: datetime):
        self.user_id = user_id
        self.token = token
        self.expires_at = expires_at

    def is_expired(self) -> bool:
        """Check if the session has expired."""
        return datetime.now() > self.expires_at


class AuthService:
    """Service for user authentication and session management."""

    def __init__(self, user_repository: UserRepository):
        self.user_repo = user_repository
        self.sessions: dict[str, Session] = {}
        self.session_duration = timedelta(hours=24)

    def _generate_token(self) -> str:
        """Generate a secure random session token."""
        return secrets.token_urlsafe(32)

    def login(self, username: str, password: str) -> str:
        """Authenticate user and create a session."""
        logger.info(f"Login attempt for user: {username}")

        user = self.user_repo.find_by_username(username)
        if not user:
            logger.warning(f"Login failed - user not found: {username}")
            raise AuthenticationError("Invalid username or password")

        if not user.is_active:
            logger.warning(f"Login failed - user deactivated: {username}")
            raise AuthenticationError("Account is deactivated")

        if not user.verify_password(password):
            logger.warning(f"Login failed - invalid password: {username}")
            raise AuthenticationError("Invalid username or password")

        # Create session
        token = self._generate_token()
        expires_at = datetime.now() + self.session_duration
        session = Session(user.id, token, expires_at)
        self.sessions[token] = session

        logger.info(f"Login successful for user: {username}")
        return token

    def logout(self, token: str) -> bool:
        """Invalidate a session."""
        if token in self.sessions:
            del self.sessions[token]
            logger.info("Session invalidated")
            return True
        return False

    def validate_session(self, token: str) -> Optional[int]:
        """Validate a session token and return user ID."""
        session = self.sessions.get(token)

        if not session:
            return None

        if session.is_expired():
            del self.sessions[token]
            return None

        return session.user_id

    def get_current_user(self, token: str) -> Optional[User]:
        """Get the user associated with a session token."""
        user_id = self.validate_session(token)
        if not user_id:
            return None

        # Note: would need to add find_by_id to UserRepository
        return None

    def cleanup_expired_sessions(self) -> int:
        """Remove all expired sessions."""
        expired_tokens = [
            token for token, session in self.sessions.items()
            if session.is_expired()
        ]

        for token in expired_tokens:
            del self.sessions[token]

        logger.info(f"Cleaned up {len(expired_tokens)} expired sessions")
        return len(expired_tokens)
