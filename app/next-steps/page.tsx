import BackToMapChip from "../components/BackToMapChip";

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
          Roadmap from the current release onward.
        </p>

        <div style={{ marginTop: 6, marginBottom: 8, fontWeight: 700, fontSize: 15 }}>
          Recently delivered
        </div>

        <ol start={1} style={{ margin: 0, padding: "0 0 0 18px", fontSize: 14, opacity: 0.92 }}>
          <li style={{ marginBottom: 8 }}>
            Find my area scoring with weighted preferences (budget, flood safety, schools, primary schools,
            train stations, community age, and crime safety) and an area-match filter.
          </li>
          <li style={{ marginBottom: 8 }}>
            Overlays: flood risk, secondary and primary school quality, crime density (absolute &amp; relative),
            community age, train stations, GE2024 vote view, and commute distance.
          </li>
          <li style={{ marginBottom: 8 }}>
            Postcode search, Locate me, and postcode handoff to external listings with active map
            context.
          </li>
          <li style={{ marginBottom: 8 }}>
            Mobile UX pass: quick filter dock, cleaner overlays, and improved panel behavior.
          </li>
          <li style={{ marginBottom: 8 }}>
            Interactive guided tour (&ldquo;Show me&rdquo;) walking through every feature section by section.
          </li>
          <li>
            Back-to-map docs navigation now restores the previous map state instead of resetting.
          </li>
        </ol>

        <div style={{ marginTop: 14, marginBottom: 8, fontWeight: 700, fontSize: 15 }}>
          Planned next
        </div>

        <ol start={1} style={{ margin: 0, padding: "0 0 0 18px", fontSize: 14, opacity: 0.92 }}>
          <li style={{ marginBottom: 8 }}>
            Modelled price estimates for sparse areas &mdash; using up to five years of local
            price history relative to the surrounding area, the map will fill in estimated
            values for cells with too few recent sales to give a reliable median. A toggle
            lets you choose between actual data only, actual where available plus estimates
            elsewhere, or estimates everywhere for a fuller picture.
          </li>
          <li style={{ marginBottom: 8 }}>
            Confidence and coverage indicators per cell (sales bands, low-data flags,
            and freshness hints).
          </li>
          <li style={{ marginBottom: 8 }}>
            Comparison mode (side-by-side metrics or then-vs-now slider).
          </li>
          <li style={{ marginBottom: 8 }}>
            Expand flood/school data coverage to Wales and Scotland and improve sourcing alignment
            with official UK datasets.
          </li>
          <li style={{ marginBottom: 8 }}>
            Affordability layers after integrating income signals (e.g. price-to-income).
          </li>
          <li style={{ marginBottom: 8 }}>
            Commute filter &mdash; enter a work location and a maximum journey time, and the map
            shows only areas that fall within that commute. Initial version covers driving times,
            with public transport estimates to follow.
          </li>
          <li>
            Underrated best-value areas near a chosen location &mdash; a ranked list of
            hidden-gem cells that score well on schools, safety, and transport but are
            priced below what comparable areas command elsewhere.
          </li>
        </ol>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BackToMapChip />
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
