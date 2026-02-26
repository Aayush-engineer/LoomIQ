import { EventEmitter } from 'events';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { DatabaseService } from '../database/database-service';


export interface TokenPayload {
  userId: string;
  username: string;
  roles: string[];
  permissions: string[];
}

export interface UserCreateRequest {
  email: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  roles?: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

// ── System roles (unchanged) ─────────────────────────────────────────────────
export const SYSTEM_ROLES = {
  ADMIN: {
    id: 'admin', name: 'Administrator', description: 'Full system access',
    permissions: ['*:*'],
  },
  DEVELOPER: {
    id: 'developer', name: 'Developer', description: 'Can create and manage tasks',
    permissions: ['tasks:create','tasks:read','tasks:update','tasks:delete','tasks:execute',
      'projects:create','projects:read','projects:update','projects:delete',
      'agents:read','analytics:read','templates:*','workflows:*','knowledge:*'],
  },
  OPERATOR: {
    id: 'operator', name: 'Operator', description: 'Can execute and monitor tasks',
    permissions: ['tasks:read','tasks:execute','projects:read','agents:read',
      'analytics:read','workflows:execute','knowledge:read'],
  },
  VIEWER: {
    id: 'viewer', name: 'Viewer', description: 'Read-only access',
    permissions: ['tasks:read','projects:read','agents:read','analytics:read','knowledge:read'],
  },
};


export class AuthService extends EventEmitter {
  private logger: winston.Logger;
  private jwtSecret: string;
  private jwtAccessExpiresIn  = '24h';
  private jwtRefreshExpiresIn = '7d';

  constructor(private db: DatabaseService, jwtSecret?: string) {
    super();

    const secret = jwtSecret || process.env.JWT_SECRET;
    if (!secret) {
      
      throw new Error('JWT_SECRET must be set in environment variables');
    }
    this.jwtSecret = secret;

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports: [new winston.transports.Console({ format: winston.format.simple() })],
    });

    this.initializeSystemRoles();
    this.createDefaultAdmin();
  }

  
  private async initializeSystemRoles(): Promise<void> {
    try {
      const roleRepo = this.db.getDataSource().getRepository('Role');
      for (const roleData of Object.values(SYSTEM_ROLES)) {
        const exists = await roleRepo.findOne({ where: { name: roleData.name } });
        if (!exists) {
          await roleRepo.save({
            id: uuidv4(),
            name: roleData.name,
            description: roleData.description,
            permissions: roleData.permissions,
            isSystem: true,
          });
        }
      }
      this.logger.info('System roles initialized');
    } catch (err) {
      
      this.logger.warn('Could not seed system roles (DB may not be ready):', err);
    }
  }

  private async createDefaultAdmin(): Promise<void> {
    try {
      const existing = await this.db.users.findByUsername('admin');
      if (!existing) {
        await this.createUser({
          email: 'admin@loomiq.local',
          username: 'admin',
          password: 'admin123',
          firstName: 'System',
          lastName: 'Administrator',
          roles: ['admin'],
        });
        this.logger.info('Default admin user created');
      }
    } catch (err) {
      this.logger.warn('Could not create default admin:', err);
    }
  }

  
  public async createUser(request: UserCreateRequest): Promise<any> {
    
    const emailExists = await this.db.users.findByEmail(request.email);
    if (emailExists) throw new Error('Email already exists');

    const usernameExists = await this.db.users.findByUsername(request.username);
    if (usernameExists) throw new Error('Username already exists');

    const passwordHash = await bcrypt.hash(request.password, 12); 

    const roles = request.roles || ['viewer'];

    const user = await this.db.users.create({
      id: uuidv4(),
      email: request.email,
      username: request.username,
      passwordHash,
      firstName: request.firstName,
      lastName: request.lastName,
      roles,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    this.logger.info(`User created: ${user.username}`);
    this.emit('user:created', this.sanitize(user));
    return this.sanitize(user);
  }

  
  public async login(request: LoginRequest): Promise<{ user: any; token: AuthToken }> {
    
    const user = await this.db.users.findByUsername(request.username)
      ?? await this.db.users.findByEmail(request.username);

    if (!user || !user.isActive) throw new Error('Invalid credentials');

    const valid = await bcrypt.compare(request.password, user.passwordHash);
    if (!valid) throw new Error('Invalid credentials');

    await this.db.users.updateLastLogin(user.id);

    const token = this.generateTokens(user);
    this.logger.info(`User logged in: ${user.username}`);
    this.emit('user:login', user);

    return { user: this.sanitize(user), token };
  }

  
  public async verifyToken(token: string): Promise<TokenPayload> {
    try {
      return jwt.verify(token, this.jwtSecret) as TokenPayload;
    } catch {
      throw new Error('Invalid or expired token');
    }
  }

  
  public async refreshToken(refreshToken: string): Promise<AuthToken> {
    let payload: any;
    try {
      payload = jwt.verify(refreshToken, this.jwtSecret + '_refresh') as TokenPayload;
    } catch {
      throw new Error('Invalid refresh token');
    }

    const user = await this.db.users.findById(payload.userId);
    if (!user || !user.isActive) throw new Error('User not found or inactive');

    return this.generateTokens(user);
  }

  
  private generateTokens(user: any): AuthToken {
    const payload: TokenPayload = {
      userId:      user.id,
      username:    user.username,
      roles:       (user.roles as string[]) || [],
      permissions: this.resolvePermissions(user.roles || []),
    };

    const accessToken = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtAccessExpiresIn,
    } as jwt.SignOptions);

   
    const refreshToken = jwt.sign(
      { userId: user.id, username: user.username, type: 'refresh' },
      this.jwtSecret + '_refresh',
      { expiresIn: this.jwtRefreshExpiresIn } as jwt.SignOptions
    );

    return { accessToken, refreshToken, expiresIn: 86_400, tokenType: 'Bearer' };
  }

  private resolvePermissions(roleIds: string[]): string[] {
    const perms = new Set<string>();
    for (const id of roleIds) {
      const role = Object.values(SYSTEM_ROLES).find(r => r.id === id);
      if (role) role.permissions.forEach(p => perms.add(p));
    }
    return Array.from(perms);
  }

  
  public async getUser(userId: string): Promise<any | undefined> {
    const user = await this.db.users.findById(userId);
    return user ? this.sanitize(user) : undefined;
  }

  public async getAllUsers(): Promise<any[]> {
    const users = await this.db.users.findAll();
    return users.map(u => this.sanitize(u));
  }

  public async updateUser(userId: string, updates: any): Promise<any> {
    const updated = await this.db.users.update(userId, {
      ...updates,
      updatedAt: new Date(),
    });
    if (!updated) throw new Error('User not found');
    return this.sanitize(updated);
  }

  public async changePassword(userId: string, oldPwd: string, newPwd: string): Promise<void> {
    const user = await this.db.users.findById(userId);
    if (!user) throw new Error('User not found');

    const valid = await bcrypt.compare(oldPwd, user.passwordHash);
    if (!valid) throw new Error('Invalid old password');

    await this.db.users.update(userId, {
      passwordHash: await bcrypt.hash(newPwd, 12),
      updatedAt: new Date(),
    });
    this.emit('user:passwordChanged', { userId });
  }

  
  public hasPermission(user: any, permission: string): boolean {
    const roles: string[] = user.roles || [];
    if (roles.includes('admin')) return true;

    const perms = this.resolvePermissions(roles);
    const [resource] = permission.split(':');
    return perms.includes('*:*') ||
           perms.includes(`${resource}:*`) ||
           perms.includes(permission);
  }

  
  private sanitize(user: any): any {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}