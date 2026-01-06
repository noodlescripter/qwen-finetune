"""Database connection and query utilities."""
from typing import Any, Optional
from contextlib import contextmanager
import sqlite3


class DatabaseConnection:
    """SQLite database connection manager."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.connection: Optional[sqlite3.Connection] = None

    def connect(self) -> None:
        """Establish database connection."""
        self.connection = sqlite3.connect(self.db_path)
        self.connection.row_factory = sqlite3.Row

    def disconnect(self) -> None:
        """Close database connection."""
        if self.connection:
            self.connection.close()
            self.connection = None

    @contextmanager
    def get_cursor(self):
        """Context manager for database cursor."""
        if not self.connection:
            self.connect()
        cursor = self.connection.cursor()
        try:
            yield cursor
            self.connection.commit()
        except Exception as e:
            self.connection.rollback()
            raise e
        finally:
            cursor.close()

    def execute_query(self, query: str, params: tuple = ()) -> list[dict]:
        """Execute a SELECT query and return results."""
        with self.get_cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def execute_insert(self, query: str, params: tuple = ()) -> int:
        """Execute an INSERT query and return the last row ID."""
        with self.get_cursor() as cursor:
            cursor.execute(query, params)
            return cursor.lastrowid

    def execute_update(self, query: str, params: tuple = ()) -> int:
        """Execute an UPDATE query and return affected rows."""
        with self.get_cursor() as cursor:
            cursor.execute(query, params)
            return cursor.rowcount


def create_connection(db_path: str) -> DatabaseConnection:
    """Factory function to create a database connection."""
    db = DatabaseConnection(db_path)
    db.connect()
    return db
