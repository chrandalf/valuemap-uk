export default function DescriptionPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0c14",
        color: "white",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 860,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.16)",
          borderRadius: 14,
          padding: 20,
          lineHeight: 1.5,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Description</h1>
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>
          UK House Price Map — Grid-Based Analysis
        </p>

        <Section title="1) Why grid-based?">
          This interactive UK house price map shows how property prices vary across the country
          using a grid-based approach rather than traditional postcode averages. By aggregating
          sales into evenly sized grid cells (from 1km up to 25km), it becomes easier to spot
          regional patterns, price gradients, and local anomalies that can be hidden when grouped
          by administrative boundaries.
        </Section>

        <Section title="2) How values are calculated">
          The map uses Land Registry price paid data, aggregated over a trailing 12-month period to
          smooth short-term volatility. For each grid cell, prices are summarised with medians,
          which are generally more robust than simple averages and less distorted by outlier sales.
          Where enough transactions exist, the map also shows recent price changes to highlight
          areas rising or falling relative to the recent past.
        </Section>

        <Section title="3) Detail controls and filters">
          You can switch grid sizes based on desired detail. Smaller grids (1km/5km) reveal local
          variation, while larger grids support broader regional comparison. Filters let you compare
          property type (detached, semi-detached, terraced, flats) and new build versus existing
          homes to keep comparisons more like-for-like.
        </Section>

        <Section title="4) How to interpret results">
          This view is useful for researching a move, comparing affordability between regions, and
          understanding how prices change with distance from city centres. Because grid cells are
          consistent in size, they avoid some distortions caused by postcode areas that vary widely
          in shape and population.
        </Section>

        <Section title="5) Scope and intended use">
          The map is an exploratory tool, not a listing service. Clicking a grid cell reveals local
          price context; individual postcodes can be explored further on external listing platforms.
          Coverage is strongest for England and Wales, with Scotland included where data availability
          allows.
        </Section>

        <Section title="6) Data caveat">
          Data is aggregated and anonymised. The goal is to surface patterns clearly, not to predict
          prices or provide formal valuation advice.
        </Section>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <NavChip href="/">Back to map</NavChip>
          <NavChip href="/next-steps">Next steps</NavChip>
          <NavChip href="/legal">Legal</NavChip>
          <NavChip href="/privacy">Privacy</NavChip>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ opacity: 0.9, fontSize: 14 }}>{children}</div>
    </section>
  );
}

function NavChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.2)",
        background: "rgba(255,255,255,0.08)",
        color: "white",
        textDecoration: "none",
        fontSize: 12,
      }}
    >
      {children}
    </a>
  );
}
