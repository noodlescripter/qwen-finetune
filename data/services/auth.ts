/**
 * Authentication service for handling user login and sessions.
 */

import { User, userModel, UserModel } from '../models/user';
import { getLogger } from '../utils/logger';

const logger = getLogger('AuthService');

export interface Session {
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface LoginResult {
  user: Omit<User, 'passwordHash'>;
  token: string;
  expiresAt: Date;
}

export interface AuthConfig {
  sessionDurationMs: number;
  maxActiveSessions: number;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthService {
  private sessions: Map<string, Session> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();
  private config: AuthConfig;
  private userModel: UserModel;

  constructor(userModel: UserModel, config?: Partial<AuthConfig>) {
    this.userModel = userModel;
    this.config = {
      sessionDurationMs: config?.sessionDurationMs ?? 24 * 60 * 60 * 1000, // 24 hours
      maxActiveSessions: config?.maxActiveSessions ?? 5,
    };
  }

  private generateToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private createSession(userId: string): Session {
    const token = this.generateToken();
    const now = new Date();
    const session: Session = {
      userId,
      token,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.sessionDurationMs),
    };

    // Manage user sessions
    let userSessionSet = this.userSessions.get(userId);
    if (!userSessionSet) {
      userSessionSet = new Set();
      this.userSessions.set(userId, userSessionSet);
    }

    // Remove oldest session if limit reached
    if (userSessionSet.size >= this.config.maxActiveSessions) {
      const oldestToken = userSessionSet.values().next().value;
      if (oldestToken) {
        this.sessions.delete(oldestToken);
        userSessionSet.delete(oldestToken);
      }
    }

    this.sessions.set(token, session);
    userSessionSet.add(token);

    return session;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    logger.info('Login attempt', { email });

    const user = this.userModel.findByEmail(email);
    if (!user) {
      logger.warn('Login failed - user not found', { email });
      throw new AuthenticationError('Invalid email or password');
    }

    if (!user.isActive) {
      logger.warn('Login failed - user deactivated', { userId: user.id });
      throw new AuthenticationError('Account is deactivated');
    }

    const validPassword = await this.userModel.verifyPassword(user, password);
    if (!validPassword) {
      logger.warn('Login failed - invalid password', { userId: user.id });
      throw new AuthenticationError('Invalid email or password');
    }

    const session = this.createSession(user.id);
    logger.info('Login successful', { userId: user.id });

    return {
      user: this.userModel.toPublicUser(user),
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  logout(token: string): boolean {
    const session = this.sessions.get(token);
    if (!session) {
      return false;
    }

    this.sessions.delete(token);
    const userSessionSet = this.userSessions.get(session.userId);
    userSessionSet?.delete(token);

    logger.info('Logout successful', { userId: session.userId });
    return true;
  }

  logoutAllSessions(userId: string): number {
    const userSessionSet = this.userSessions.get(userId);
    if (!userSessionSet) {
      return 0;
    }

    let count = 0;
    for (const token of userSessionSet) {
      this.sessions.delete(token);
      count++;
    }

    this.userSessions.delete(userId);
    logger.info('Logged out all sessions', { userId, count });
    return count;
  }

  validateToken(token: string): Session | null {
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }

    if (new Date() > session.expiresAt) {
      this.sessions.delete(token);
      const userSessionSet = this.userSessions.get(session.userId);
      userSessionSet?.delete(token);
      return null;
    }

    return session;
  }

  getCurrentUser(token: string): Omit<User, 'passwordHash'> | null {
    const session = this.validateToken(token);
    if (!session) {
      return null;
    }

    const user = this.userModel.findById(session.userId);
    if (!user) {
      return null;
    }

    return this.userModel.toPublicUser(user);
  }

  cleanupExpiredSessions(): number {
    const now = new Date();
    let count = 0;

    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(token);
        const userSessionSet = this.userSessions.get(session.userId);
        userSessionSet?.delete(token);
        count++;
      }
    }

    logger.info('Cleaned up expired sessions', { count });
    return count;
  }
}

export const authService = new AuthService(userModel);
