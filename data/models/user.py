"""User model and related operations."""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import hashlib


@dataclass
class User:
    """User entity representing application users."""
    id: Optional[int]
    username: str
    email: str
    password_hash: str
    created_at: datetime
    is_active: bool = True

    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using SHA-256."""
        return hashlib.sha256(password.encode()).hexdigest()

    def verify_password(self, password: str) -> bool:
        """Verify a password against the stored hash."""
        return self.password_hash == self.hash_password(password)

    def to_dict(self) -> dict:
        """Convert user to dictionary representation."""
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "created_at": self.created_at.isoformat(),
            "is_active": self.is_active,
        }


class UserRepository:
    """Repository for user database operations."""

    def __init__(self, db_connection):
        self.db = db_connection

    def create_user(self, username: str, email: str, password: str) -> User:
        """Create a new user in the database."""
        password_hash = User.hash_password(password)
        created_at = datetime.now()

        query = """
            INSERT INTO users (username, email, password_hash, created_at, is_active)
            VALUES (?, ?, ?, ?, ?)
        """
        user_id = self.db.execute_insert(
            query, (username, email, password_hash, created_at, True)
        )

        return User(
            id=user_id,
            username=username,
            email=email,
            password_hash=password_hash,
            created_at=created_at,
        )

    def find_by_username(self, username: str) -> Optional[User]:
        """Find a user by username."""
        query = "SELECT * FROM users WHERE username = ?"
        results = self.db.execute_query(query, (username,))

        if not results:
            return None

        row = results[0]
        return User(
            id=row["id"],
            username=row["username"],
            email=row["email"],
            password_hash=row["password_hash"],
            created_at=datetime.fromisoformat(row["created_at"]),
            is_active=row["is_active"],
        )

    def find_by_email(self, email: str) -> Optional[User]:
        """Find a user by email address."""
        query = "SELECT * FROM users WHERE email = ?"
        results = self.db.execute_query(query, (email,))

        if not results:
            return None

        row = results[0]
        return User(
            id=row["id"],
            username=row["username"],
            email=row["email"],
            password_hash=row["password_hash"],
            created_at=datetime.fromisoformat(row["created_at"]),
            is_active=row["is_active"],
        )

    def deactivate_user(self, user_id: int) -> bool:
        """Deactivate a user account."""
        query = "UPDATE users SET is_active = ? WHERE id = ?"
        affected = self.db.execute_update(query, (False, user_id))
        return affected > 0
