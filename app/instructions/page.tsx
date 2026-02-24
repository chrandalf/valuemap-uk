export default function InstructionsPage() {
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
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Instructions</h1>
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>
          How to use the map and interpret results.
        </p>

        <Section title="1) Start with controls">
          Use Grid and Metric to choose the analysis level first, then set Type and New build so
          comparisons stay like-for-like.
        </Section>

        <Section title="2) Understand overlays">
          Flood, schools, and votes are contextual overlays. Use them to compare patterns, then
          verify with official sources before making any decision.
        </Section>

        <Section title="3) Value filtering">
          Value filter can hide cells above or below a threshold. Threshold units adapt to the
          selected metric (price, £/ft², £ change, or % change).
        </Section>

        <Section title="4) Read results carefully">
          Medians are robust but still affected by sales mix and sample sizes. Treat this tool as
          exploratory analysis rather than formal valuation or advice.
        </Section>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <NavChip href="/">Back to map</NavChip>
          <NavChip href="/data-sources">Data sources</NavChip>
          <NavChip href="/election-info">Election info</NavChip>
          <NavChip href="/description">Description</NavChip>
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
