import BackToMapChip from "../components/BackToMapChip";

export default function DataSourcesPage() {
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
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Data sources</h1>
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>
          Main datasets currently used in this build.
        </p>

        <ol start={1} style={{ margin: 0, padding: "0 0 0 18px", fontSize: 14, opacity: 0.92 }}>
          <li style={{ marginBottom: 8 }}>
            HM Land Registry Price Paid Data (sold price transactions, England &amp; Wales).
          </li>
          <li style={{ marginBottom: 8 }}>
            Registers of Scotland (sold price transactions, Scotland).
          </li>
          <li style={{ marginBottom: 8 }}>
            Office for National Statistics: ONSPD postcode centroids.
          </li>
          <li style={{ marginBottom: 8 }}>
            Energy Performance of Buildings Register (Domestic EPC data) — Department for
            Levelling Up, Housing and Communities.
          </li>
          <li style={{ marginBottom: 8 }}>
            Environment Agency Flood Risk Register (flood monitoring points, England).
          </li>
          <li style={{ marginBottom: 8 }}>
            Department for Education / Ofsted inspection data and KS4 GCSE results (school quality, England).
          </li>
          <li style={{ marginBottom: 8 }}>
            Police UK open crime data, aggregated to LSOA level (England &amp; Wales).
          </li>
          <li style={{ marginBottom: 8 }}>
            ONS Census 2021 (community age profiles and commute distance, Great Britain).
          </li>
          <li style={{ marginBottom: 8 }}>
            Office of Rail and Road / National Rail (station locations, Great Britain).
          </li>
          <li>
            Electoral Commission — General Election 2024 results (constituency-level vote shares, Great Britain).
          </li>
        </ol>

        <div style={{ marginTop: 12, opacity: 0.82, fontSize: 13 }}>
          Licensing and attribution follow the terms provided by each source.
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BackToMapChip />
          <NavChip href="/instructions">Instructions</NavChip>
          <NavChip href="/election-info">Election info</NavChip>
          <NavChip href="/legal">Legal</NavChip>
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
