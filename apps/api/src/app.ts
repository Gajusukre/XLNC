import express, { Express } from 'express';
import { Dependencies } from './adapters.factory';
import { propertiesRouter } from './routes/properties.route';
import { pricingRouter } from './routes/pricing.route';
import { syncRouter } from './routes/sync.route';
import { authRouter } from './routes/auth.route';
import { authenticate, authorize } from './auth/auth.middleware';
import { createGeneralRateLimiter } from './auth/rate-limit.middleware';

export function createApp(deps: Dependencies): Express {
  const app = express();
  app.set('trust proxy', 1); // needed for correct req.ip behind a VPS reverse proxy
  app.use(express.json());
  app.use(createGeneralRateLimiter());

  // Public — standard practice for health checks (used by orchestrators/monitoring).
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      adapters: {
        hostify: deps.hostify.mode,
        pricelabs: deps.priceLabs.mode,
      },
      database: deps.dbAvailable() ? 'connected' : 'unavailable',
    });
  });

  // Public (rate-limited on /login specifically, see auth.route.ts).
  app.use('/auth', authRouter(deps));

  // Any authenticated role (viewer, manager, admin) can read pricing/property data.
  app.use('/properties', authenticate, authorize('viewer', 'manager', 'admin'), propertiesRouter(deps));
  app.use('/pricing', authenticate, authorize('viewer', 'manager', 'admin'), pricingRouter(deps));

  // Sync triggers writes — restricted to manager/admin.
  app.use('/sync', authenticate, authorize('manager', 'admin'), syncRouter(deps));

  return app;
}
