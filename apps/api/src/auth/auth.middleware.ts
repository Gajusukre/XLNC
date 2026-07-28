import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@xlnc/database';
import { verifyAccessToken } from './jwt.util';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: UserRole };
    }
  }
}

/**
 * Verifies the JWT access token in the Authorization header and attaches
 * the decoded identity to req.user. Deliberately does not re-check the DB
 * on every request — access tokens are short-lived (15 min), so
 * deactivation/role changes take effect within that window rather than
 * instantly. Refresh-token revocation (logout, "log out everywhere") is
 * where immediate revocation actually happens.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

/** Must run after authenticate(). Rejects with 403 if role isn't allowed. */
export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: `Requires one of roles: ${allowedRoles.join(', ')}` });
      return;
    }
    next();
  };
}
