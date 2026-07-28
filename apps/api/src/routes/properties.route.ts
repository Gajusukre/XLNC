import { Router } from 'express';
import { Dependencies } from '../adapters.factory';

export function propertiesRouter(deps: Dependencies): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const properties = await deps.hostify.listProperties();
      res.json({ properties, source: deps.hostify.mode });
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch properties', detail: (err as Error).message });
    }
  });

  router.get('/:id/availability', async (req, res) => {
    const { from, to } = req.query;
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'Query params "from" and "to" (ISO dates) are required' });
      return;
    }
    try {
      const availability = await deps.hostify.getAvailability(req.params.id, from, to);
      res.json({ availability, source: deps.hostify.mode });
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch availability', detail: (err as Error).message });
    }
  });

  return router;
}
