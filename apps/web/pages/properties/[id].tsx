import { GetServerSideProps } from 'next';
import Link from 'next/link';
import { Layout } from '../../components/Layout';
import { PricingTable } from '../../components/PricingTable';
import { fetchWithAuth, UnauthorizedError, readSessionCookies, decodeJwtPayloadForDisplay } from '../../lib/session';

interface Property {
  id: string;
  name: string;
  address: string;
}

interface Recommendation {
  date: string;
  currentPrice: number;
  recommendedPrice: number;
  changePercent: number;
  reason: string;
  source: 'live' | 'mock';
}

interface HistoryEntry extends Recommendation {
  computedAt: string;
}

interface PageProps {
  property: Property | null;
  recommendations: Recommendation[];
  history: HistoryEntry[];
  error: string | null;
  viewer: { email?: string; role?: string } | null;
}

export default function PropertyDetailPage({ property, recommendations, history, error, viewer }: PageProps) {
  return (
    <Layout title={property ? property.name : 'Property'} viewer={viewer}>
      <p>
        <Link href="/">&larr; All properties</Link>
      </p>

      {error && (
        <p style={{ color: 'crimson', border: '1px solid crimson', padding: '0.75rem' }}>{error}</p>
      )}

      {property && <p style={{ color: '#666' }}>{property.address}</p>}

      <h3>Current pricing recommendations (next 7 days)</h3>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Loading this page re-computes and persists a fresh recommendation for each day shown.
      </p>
      <PricingTable recommendations={recommendations} />

      <h3 style={{ marginTop: '2rem' }}>Recommendation history (audit trail)</h3>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Every recommendation ever computed for this property is kept — this shows how the
        recommendation for each date has changed across sync runs, not just the latest.
      </p>
      {history.length === 0 ? (
        <p style={{ color: '#666' }}>No history recorded yet.</p>
      ) : (
        <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
              <th>Target Date</th>
              <th>Computed At</th>
              <th>Recommended Price</th>
              <th>Change</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td>{h.date}</td>
                <td>{new Date(h.computedAt).toLocaleString()}</td>
                <td>${h.recommendedPrice}</td>
                <td style={{ color: h.changePercent >= 0 ? 'green' : 'crimson' }}>
                  {h.changePercent > 0 ? '+' : ''}
                  {h.changePercent}%
                </td>
                <td>{h.source === 'mock' ? '⚠️ mock' : '✅ live'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps<PageProps> = async ({ req, res, params }) => {
  const apiUrl = process.env.API_URL || 'http://localhost:4000';
  const propertyId = params?.id as string;
  const from = '2026-08-01';
  const to = '2026-08-07';

  const { accessToken } = readSessionCookies(req);
  if (!accessToken) {
    return { redirect: { destination: `/login?from=/properties/${propertyId}`, permanent: false } };
  }

  try {
    const [propsRes, recsRes] = await Promise.all([
      fetchWithAuth(apiUrl, '/properties', req, res),
      fetchWithAuth(apiUrl, `/pricing/${propertyId}/recommendations?from=${from}&to=${to}`, req, res),
    ]);

    if (!propsRes.ok || !recsRes.ok) {
      throw new Error(`API returned ${propsRes.status}/${recsRes.status}`);
    }

    const propsData = await propsRes.json();
    const recsData = await recsRes.json();
    const property = propsData.properties.find((p: Property) => p.id === propertyId) ?? null;

    // History is best-effort: if the DB is unavailable this 503s, but that
    // shouldn't take down the whole page — the live recommendations above
    // already succeeded and are the primary value.
    let history: HistoryEntry[] = [];
    try {
      const historyRes = await fetchWithAuth(
        apiUrl,
        `/pricing/${propertyId}/history?from=${from}&to=${to}`,
        req,
        res,
      );
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        history = historyData.history;
      }
    } catch {
      // leave history empty; not fatal to the page
    }

    const { accessToken: currentToken } = readSessionCookies(req);
    const viewer = currentToken ? decodeJwtPayloadForDisplay(currentToken) : null;

    return {
      props: {
        property,
        recommendations: recsData.recommendations,
        history,
        error: null,
        viewer,
      },
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { redirect: { destination: `/login?from=/properties/${propertyId}`, permanent: false } };
    }
    return {
      props: {
        property: null,
        recommendations: [],
        history: [],
        error: `Could not reach API at ${apiUrl}: ${(err as Error).message}`,
        viewer: null,
      },
    };
  }
};
