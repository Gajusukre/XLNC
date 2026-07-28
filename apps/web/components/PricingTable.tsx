interface Recommendation {
  date: string;
  currentPrice: number;
  recommendedPrice: number;
  changePercent: number;
  reason: string;
  source: 'live' | 'mock';
}

export function PricingTable({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return <p>No pricing recommendations for this range.</p>;
  }

  return (
    <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
          <th>Date</th>
          <th>Current Price</th>
          <th>Recommended Price</th>
          <th>Change</th>
          <th>Reason</th>
          <th>Data Source</th>
        </tr>
      </thead>
      <tbody>
        {recommendations.map((rec) => (
          <tr key={rec.date} style={{ borderBottom: '1px solid #ddd' }}>
            <td>{rec.date}</td>
            <td>${rec.currentPrice}</td>
            <td>${rec.recommendedPrice}</td>
            <td style={{ color: rec.changePercent >= 0 ? 'green' : 'crimson' }}>
              {rec.changePercent > 0 ? '+' : ''}
              {rec.changePercent}%
            </td>
            <td>{rec.reason}</td>
            <td>
              <span
                title={
                  rec.source === 'mock'
                    ? 'PriceLabs credentials not yet configured — showing mock market data'
                    : 'Live PriceLabs data'
                }
              >
                {rec.source === 'mock' ? '⚠️ mock' : '✅ live'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
