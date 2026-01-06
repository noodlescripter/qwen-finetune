/**
 * User model and related operations.
 */

import { getLogger } from '../utils/logger';

const logger = getLogger('UserModel');

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  role: UserRole;
}

export type UserRole = 'admin' | 'user' | 'guest';

export interface CreateUserDto {
  username: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserDto {
  username?: string;
  email?: string;
  isActive?: boolean;
  role?: UserRole;
}

export class UserModel {
  private users: Map<string, User> = new Map();

  private generateId(): string {
    return `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async create(dto: CreateUserDto): Promise<User> {
    logger.info('Creating new user', { username: dto.username, email: dto.email });

    const existingUser = this.findByEmail(dto.email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    const existingUsername = this.findByUsername(dto.username);
    if (existingUsername) {
      throw new Error('Username is already taken');
    }

    const now = new Date();
    const user: User = {
      id: this.generateId(),
      username: dto.username,
      email: dto.email.toLowerCase(),
      passwordHash: await this.hashPassword(dto.password),
      createdAt: now,
      updatedAt: now,
      isActive: true,
      role: dto.role ?? 'user',
    };

    this.users.set(user.id, user);
    logger.info('User created successfully', { userId: user.id });
    return user;
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    const normalizedEmail = email.toLowerCase();
    return Array.from(this.users.values()).find((u) => u.email === normalizedEmail);
  }

  findByUsername(username: string): User | undefined {
    return Array.from(this.users.values()).find((u) => u.username === username);
  }

  findAll(options?: { isActive?: boolean; role?: UserRole }): User[] {
    let users = Array.from(this.users.values());

    if (options?.isActive !== undefined) {
      users = users.filter((u) => u.isActive === options.isActive);
    }

    if (options?.role) {
      users = users.filter((u) => u.role === options.role);
    }

    return users;
  }

  async update(id: string, dto: UpdateUserDto): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) {
      logger.warn('User not found for update', { userId: id });
      return null;
    }

    const updatedUser: User = {
      ...user,
      ...dto,
      updatedAt: new Date(),
    };

    this.users.set(id, updatedUser);
    logger.info('User updated', { userId: id });
    return updatedUser;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.users.delete(id);
    if (deleted) {
      logger.info('User deleted', { userId: id });
    }
    return deleted;
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    const hash = await this.hashPassword(password);
    return user.passwordHash === hash;
  }

  async deactivate(id: string): Promise<User | null> {
    return this.update(id, { isActive: false });
  }

  toPublicUser(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash, ...publicUser } = user;
    return publicUser;
  }
}

export const userModel = new UserModel();
