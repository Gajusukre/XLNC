import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HostifyMockAdapter } from '../src/hostify.mock.adapter';
import { HostifyAdapter } from '../src/hostify.adapter';
import { createHostifyAdapter } from '../src/index';

describe('HostifyMockAdapter', () => {
  const adapter = new HostifyMockAdapter();

  it('reports its provider name and mode', () => {
    expect(adapter.providerName).toBe('hostify');
    expect(adapter.mode).toBe('mock');
  });

  it('lists deterministic mock properties', async () => {
    const properties = await adapter.listProperties();
    expect(properties.length).toBeGreaterThan(0);
    expect(properties[0]).toHaveProperty('id');
    expect(properties[0]).toHaveProperty('basePrice');
  });

  it('returns the same properties on repeated calls (deterministic)', async () => {
    const first = await adapter.listProperties();
    const second = await adapter.listProperties();
    expect(first).toEqual(second);
  });

  it('returns availability for a date range with a deterministic pattern', async () => {
    const availability = await adapter.getAvailability('1001', '2026-08-01', '2026-08-07');
    expect(availability).toHaveLength(7);
    expect(availability[0].propertyId).toBe('1001');
    expect(availability.every((d) => typeof d.price === 'number')).toBe(true);
  });

  it('returns empty reservations for an unknown property id', async () => {
    const reservations = await adapter.getReservations('nonexistent', '2026-08-01', '2026-08-07');
    expect(reservations).toEqual([]);
  });
});

describe('HostifyAdapter (live)', () => {
  it('throws if constructed without an API key', () => {
    expect(() => new HostifyAdapter('')).toThrow(/requires an API key/);
  });

  it('constructs successfully with an API key', () => {
    expect(() => new HostifyAdapter('fake-key-for-construction-test')).not.toThrow();
  });
});

describe('createHostifyAdapter factory', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns a mock adapter and warns when HOSTIFY_API_KEY is absent', () => {
    const adapter = createHostifyAdapter({} as NodeJS.ProcessEnv);
    expect(adapter.mode).toBe('mock');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('MOCK mode'));
  });

  it('returns a live adapter and logs when HOSTIFY_API_KEY is present', () => {
    const adapter = createHostifyAdapter({ HOSTIFY_API_KEY: 'test-key' } as NodeJS.ProcessEnv);
    expect(adapter.mode).toBe('live');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('LIVE mode'));
  });
});
