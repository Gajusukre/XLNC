import rateLimit from 'express-rate-limit';

/**
 * Factory functions, not shared singletons — express-rate-limit's default
 * in-memory store is per-instance. Sharing one instance across multiple
 * createApp() calls (which happens in tests, and could happen in any
 * multi-instance-per-process setup) would silently share rate-limit state
 * across otherwise-independent app instances. Each createApp() call gets
 * its own limiters.
 */

/** General API throttle: 300 requests / 15 min per IP. */
export function createGeneralRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Stricter limiter on the login endpoint specifically — this is the
 * brute-force-relevant surface, so it gets a much tighter budget than
 * general API traffic.
 */
export function createLoginRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' },
  });
}
