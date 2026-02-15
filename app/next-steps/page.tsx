export default function NextStepsPage() {
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
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Next steps</h1>
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>
          Planned roadmap for upcoming versions.
        </p>

        <ol start={1} style={{ margin: 0, padding: "0 0 0 18px", fontSize: 14, opacity: 0.92 }}>
          <li style={{ marginBottom: 8 }}>
            v0.2: Improve and migrate flood data sourcing toward more official UK government flood
            datasets (rivers/sea and surface water) to better test correlation between flood risk
            and price changes.
          </li>
          <li style={{ marginBottom: 8 }}>
            v0.3: Add EPC-linked property detail to filter by rooms and compute price per square
            metre or square foot.
          </li>
          <li style={{ marginBottom: 8 }}>
            v0.4: Add confidence/coverage indicators per cell (for example sales-count banding or
            low-data flags).
          </li>
          <li style={{ marginBottom: 8 }}>
            v0.5: Add comparison mode with side-by-side metrics or a then-vs-now slider.
          </li>
          <li style={{ marginBottom: 8 }}>
            v0.6: Add commuting/transport overlays (rail and metro stations) to contextualize price
            gradients.
          </li>
          <li>
            v0.7: Add affordability layers after integrating income data (price-to-income ratios).
          </li>
        </ol>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <NavChip href="/">Back to map</NavChip>
          <NavChip href="/description">Description</NavChip>
          <NavChip href="/legal">Legal</NavChip>
          <NavChip href="/privacy">Privacy</NavChip>
        </div>
      </div>
    </main>
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
