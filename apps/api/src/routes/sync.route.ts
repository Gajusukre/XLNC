import { Router } from 'express';
import { Dependencies } from '../adapters.factory';

export function syncRouter(deps: Dependencies): Router {
  const router = Router();

  router.post('/properties', async (req, res) => {
    if (!deps.dbAvailable()) {
      res.status(503).json({ error: 'Database unavailable — cannot sync right now' });
      return;
    }
    try {
      const result = await deps.syncService.syncProperties();
      await deps.auditLog.record({
        userId: req.user?.id,
        action: 'sync_triggered',
        resource: 'properties',
        success: true,
        ipAddress: req.ip,
        detail: `${result.count} records`,
      });
      res.json(result);
    } catch (err) {
      await deps.auditLog.record({
        userId: req.user?.id,
        action: 'sync_triggered',
        resource: 'properties',
        success: false,
        ipAddress: req.ip,
        detail: (err as Error).message,
      });
      res.status(502).json({ error: 'Property sync failed', detail: (err as Error).message });
    }
  });

  router.post('/:propertyId/reservations', async (req, res) => {
    const { from, to } = req.query;
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'Query params "from" and "to" (ISO dates) are required' });
      return;
    }
    if (!deps.dbAvailable()) {
      res.status(503).json({ error: 'Database unavailable — cannot sync right now' });
      return;
    }
    try {
      const result = await deps.syncService.syncReservations(req.params.propertyId, from, to);
      await deps.auditLog.record({
        userId: req.user?.id,
        action: 'sync_triggered',
        resource: `reservations:${req.params.propertyId}`,
        success: true,
        ipAddress: req.ip,
        detail: `${result.count} records`,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: 'Reservation sync failed', detail: (err as Error).message });
    }
  });

  router.get('/runs', async (req, res) => {
    if (!deps.dbAvailable()) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    const jobName = typeof req.query.jobName === 'string' ? req.query.jobName : undefined;
    const runs = await deps.syncRuns.recent(jobName);
    res.json({ runs });
  });

  return router;
}
