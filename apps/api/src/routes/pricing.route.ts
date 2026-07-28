import { Router } from 'express';
import { Dependencies } from '../adapters.factory';

export function pricingRouter(deps: Dependencies): Router {
  const router = Router();

  router.get('/:propertyId/recommendations', async (req, res) => {
    const { from, to } = req.query;
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'Query params "from" and "to" (ISO dates) are required' });
      return;
    }
    try {
      const recommendations = await deps.pricingEngine.recommendForProperty(
        req.params.propertyId,
        from,
        to,
      );

      // Persist as a best-effort side effect. A DB hiccup must never block
      // the caller from getting their pricing recommendation — the
      // recommendation itself already succeeded above.
      let persisted = false;
      if (deps.dbAvailable()) {
        try {
          await deps.pricingHistory.recordMany(recommendations);
          persisted = true;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[pricing-history] failed to persist recommendations: ${(err as Error).message}`,
          );
        }
      }

      res.json({ recommendations, persisted });
    } catch (err) {
      const message = (err as Error).message;
      const status = message.startsWith('Unknown property') ? 404 : 502;
      res.status(status).json({ error: 'Failed to compute pricing recommendations', detail: message });
    }
  });

  router.get('/:propertyId/history', async (req, res) => {
    const { from, to, latestOnly } = req.query;
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'Query params "from" and "to" (ISO dates) are required' });
      return;
    }
    if (!deps.dbAvailable()) {
      res.status(503).json({ error: 'Database unavailable — pricing history cannot be served right now' });
      return;
    }
    try {
      const history =
        latestOnly === 'true'
          ? await deps.pricingHistory.findLatestForProperty(req.params.propertyId, from, to)
          : await deps.pricingHistory.findHistoryForProperty(req.params.propertyId, from, to);
      res.json({ history });
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch pricing history', detail: (err as Error).message });
    }
  });

  return router;
}
