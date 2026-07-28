import { GetServerSideProps } from 'next';
import Link from 'next/link';
import { Layout } from '../components/Layout';
import { fetchWithAuth, UnauthorizedError, readSessionCookies, decodeJwtPayloadForDisplay } from '../lib/session';

interface Property {
  id: string;
  name: string;
  address: string;
  bedrooms: number;
  bathrooms: number;
  basePrice: number;
  currency: string;
}

interface PageProps {
  properties: Property[];
  error: string | null;
  viewer: { email?: string; role?: string } | null;
}

export default function PropertyListPage({ properties, error, viewer }: PageProps) {
  return (
    <Layout title="Properties" viewer={viewer}>
      {error && (
        <p style={{ color: 'crimson', border: '1px solid crimson', padding: '0.75rem' }}>{error}</p>
      )}

      {properties.length === 0 && !error && (
        <p style={{ color: '#666' }}>
          No properties synced yet. A manager or admin can trigger a sync via <code>POST /sync/properties</code>.
        </p>
      )}

      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
            <th>Property</th>
            <th>Address</th>
            <th>Beds / Baths</th>
            <th>Base Price</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #ddd' }}>
              <td>
                <Link href={`/properties/${p.id}`}>{p.name}</Link>
              </td>
              <td>{p.address}</td>
              <td>
                {p.bedrooms} / {p.bathrooms}
              </td>
              <td>
                {p.basePrice} {p.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps<PageProps> = async ({ req, res }) => {
  const apiUrl = process.env.API_URL || 'http://localhost:4000';
  const { accessToken } = readSessionCookies(req);
  if (!accessToken) {
    return { redirect: { destination: '/login?from=/', permanent: false } };
  }

  try {
    const propsRes = await fetchWithAuth(apiUrl, '/properties', req, res);
    if (!propsRes.ok) {
      throw new Error(`API returned ${propsRes.status}`);
    }
    const propsData = await propsRes.json();

    const { accessToken: currentToken } = readSessionCookies(req);
    const viewer = currentToken ? decodeJwtPayloadForDisplay(currentToken) : null;

    return {
      props: {
        properties: propsData.properties,
        error: null,
        viewer,
      },
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { redirect: { destination: '/login?from=/', permanent: false } };
    }
    return {
      props: {
        properties: [],
        error: `Could not reach API at ${apiUrl}: ${(err as Error).message}`,
        viewer: null,
      },
    };
  }
};
