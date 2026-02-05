export default function Home() {
  return (
    <main style={{ minHeight: '100vh', padding: 40, background: '#f6f8fb', color: '#0b1220' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: 40, margin: 0 }}>ValueMap UK</h1>
        <p style={{ marginTop: 12, fontSize: 18, color: '#334155' }}>
          Explore and compare property values across the UK — medians, trends and quick local insights.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <a
            href="/explore"
            style={{
              padding: '10px 16px',
              background: '#0f172a',
              color: 'white',
              borderRadius: 8,
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Explore data
          </a>

          <a
            href="/about"
            style={{
              padding: '10px 16px',
              background: 'transparent',
              color: '#0f172a',
              borderRadius: 8,
              textDecoration: 'none',
              border: '1px solid #e2e8f0',
              fontWeight: 600,
            }}
          >
            About
          </a>
        </div>

        <section
          style={{
            marginTop: 36,
            padding: 20,
            background: 'white',
            borderRadius: 10,
            boxShadow: '0 6px 18px rgba(2,6,23,0.06)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>What you can do</h2>
          <ul style={{ marginTop: 12, color: '#475569' }}>
            <li>Browse region-by-region median house prices</li>
            <li>Compare changes over the last 12 months</li>
            <li>Save and share snapshots</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
