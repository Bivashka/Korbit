import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
  sessionId: string;
}

