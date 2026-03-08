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
            <strong>Scored area list view</strong> &mdash; after running Find My Area, browse
            your top results as a sortable table showing area name, match score, and median
            price. Click any row to fly the map straight to that spot.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Search and filter by county, city, or region</strong> &mdash; type
            &ldquo;Devon&rdquo; or &ldquo;Greater Manchester&rdquo; in the search box and pin
            scoring to that area only. An active chip shows your current region filter and
            can be cleared at any time.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Maximum distance to a train station</strong> &mdash; set a hard cap
            (e.g. 1 km, 2 km, 5 km) so areas without a nearby station are filtered out
            entirely rather than just scored lower.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>&ldquo;Avoid&rdquo; mode for scoring factors</strong> &mdash; as well as
            weighting things you want, mark factors you actively want to avoid &mdash; for
            example, heavy transport corridors or high-density areas &mdash; so the scoring
            works in both directions.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>School quality based on Ofsted grades</strong> &mdash; school scoring will
            reflect actual Ofsted inspection outcomes (Outstanding / Good / Requires Improvement
            / Inadequate) rather than exam results alone, giving a fairer picture across all
            school types including specialist schools.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Fast broadband coverage</strong> &mdash; full-fibre and superfast broadband
            availability added as a scoring factor and map overlay, sourced from Ofcom open data.
            Particularly useful for remote workers or anyone moving out of a city.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Housing stock breakdown per area</strong> &mdash; rough counts of 2-bed
            flats, 3-bed semis, 4-bed detacheds, and other types in each cell (based on EPC
            records), so you can see whether your top-scoring areas actually have the kind of
            home you&rsquo;re looking for.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Modelled price estimates for sparse areas</strong> &mdash; using up to five
            years of local price history relative to the surrounding area, the map will fill in
            estimated values for cells with too few recent sales to give a reliable median. A
            toggle lets you switch between actual data only, blended, or estimates everywhere for
            a fuller picture.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Smoother match scores near borders</strong> &mdash; a refinement pass on
            crime and school scoring to reduce cases where two adjacent streets end up with
            unrealistically different match scores due to administrative boundary edges in the
            underlying data.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Commute filter</strong> &mdash; enter a work location and a maximum journey
            time, and the map shows only areas within that commute. Initial version covers driving
            times, with public transport estimates to follow.
          </li>
          <li>
            <strong>Underrated best-value areas near a chosen location</strong> &mdash; a ranked
            list of hidden-gem areas that score well on schools, safety, and transport but are
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
