import { Router } from 'express';
import { Dependencies } from '../adapters.factory';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { signAccessToken } from '../auth/jwt.util';
import { generateRefreshToken } from '../auth/refresh-token.util';
import { authenticate, authorize } from '../auth/auth.middleware';
import { createLoginRateLimiter } from '../auth/rate-limit.middleware';
import { UserRole } from '@xlnc/database';

const VALID_ROLES: UserRole[] = ['admin', 'manager', 'viewer'];

export function authRouter(deps: Dependencies): Router {
  const router = Router();
  const loginRateLimiter = createLoginRateLimiter();

  router.post('/login', loginRateLimiter, async (req, res) => {
    if (!deps.dbAvailable()) {
      res.status(503).json({ error: 'Database unavailable — cannot authenticate right now' });
      return;
    }
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: '"email" and "password" are required' });
      return;
    }

    const user = await deps.users.findByEmail(email);
    const genericFailure = () => {
      res.status(401).json({ error: 'Invalid credentials' });
    };

    if (!user || !user.isActive) {
      await deps.auditLog.record({
        userId: null,
        action: 'login_failure',
        success: false,
        ipAddress: req.ip,
        detail: `email=${email}`,
      });
      genericFailure();
      return;
    }

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) {
      await deps.auditLog.record({
        userId: user.id,
        action: 'login_failure',
        success: false,
        ipAddress: req.ip,
      });
      genericFailure();
      return;
    }

    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const { raw: refreshToken, expiresAt } = generateRefreshToken();
    await deps.refreshTokens.store(user.id, refreshToken, expiresAt);
    await deps.auditLog.record({
      userId: user.id,
      action: 'login_success',
      success: true,
      ipAddress: req.ip,
    });

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  router.post('/refresh', async (req, res) => {
    if (!deps.dbAvailable()) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    const { refreshToken } = req.body ?? {};
    if (typeof refreshToken !== 'string') {
      res.status(400).json({ error: '"refreshToken" is required' });
      return;
    }

    const record = await deps.refreshTokens.findValid(refreshToken);
    if (!record) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    const user = await deps.users.findById(record.userId);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Account no longer active' });
      return;
    }

    // Rotate: revoke the used token, issue a new one. Limits the blast
    // radius of a leaked refresh token to a single use.
    await deps.refreshTokens.revoke(refreshToken);
    const { raw: newRefreshToken, expiresAt } = generateRefreshToken();
    await deps.refreshTokens.store(user.id, newRefreshToken, expiresAt);

    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    res.json({ accessToken, refreshToken: newRefreshToken });
  });

  router.post('/logout', async (req, res) => {
    const { refreshToken } = req.body ?? {};
    if (typeof refreshToken === 'string' && deps.dbAvailable()) {
      await deps.refreshTokens.revoke(refreshToken);
    }
    res.status(204).send();
  });

  router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user });
  });

  // Admin-only: create a new user account. No public self-registration —
  // per the spec's RBAC intent, account creation is an administrative act.
  router.post('/users', authenticate, authorize('admin'), async (req, res) => {
    if (!deps.dbAvailable()) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    const { email, password, role } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || typeof role !== 'string') {
      res.status(400).json({ error: '"email", "password", and "role" are required' });
      return;
    }
    if (!VALID_ROLES.includes(role as UserRole)) {
      res.status(400).json({ error: `"role" must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    try {
      const passwordHash = await hashPassword(password);
      const user = await deps.users.create(email, passwordHash, role as UserRole);
      await deps.auditLog.record({
        userId: req.user!.id,
        action: 'user_created',
        resource: user.id,
        success: true,
        ipAddress: req.ip,
        detail: `created ${email} as ${role}`,
      });
      res.status(201).json({ id: user.id, email: user.email, role: user.role });
    } catch (err) {
      res.status(409).json({ error: 'Could not create user (email may already exist)', detail: (err as Error).message });
    }
  });

  return router;
}
