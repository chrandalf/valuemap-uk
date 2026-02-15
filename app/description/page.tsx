"use client";

import { useState } from "react";

export default function DescriptionPage() {
  const [descriptionPage, setDescriptionPage] = useState(1);

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
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>UK House Price Map — Grid-Based Analysis</p>

        {descriptionPage === 1 && (
          <>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 8, marginBottom: 10 }}>
              Page 1 of 2
            </div>
            <Section title="1) Why grid-based?">
              This interactive UK house price map shows how property prices vary across the country
              using a grid-based approach rather than traditional postcode averages. By aggregating
              sales into evenly sized grid cells (from 1km up to 25km), it becomes much easier to
              spot regional patterns, price gradients, and local anomalies that are often hidden
              when data is grouped by administrative boundaries.
            </Section>

            <Section title="2) How values are calculated">
              The map is built using Land Registry price paid data, aggregated over a trailing
              12-month period to smooth short-term volatility. For each grid cell, prices are
              summarised using median values, which are more robust than simple averages and less
              distorted by very high or very low individual sales. Where enough transactions exist,
              the map also shows recent price changes, helping to highlight areas where prices are
              rising or falling relative to the recent past.
            </Section>

            <Section title="3) Detail controls and filters">
              You can switch between grid sizes depending on the detail you want. Smaller grids
              (such as 1km or 5km) reveal fine-grained local variation, while larger grids provide a
              broader regional view useful for comparing towns, cities, or wider housing markets.
              Filters let prices be explored by property type (detached, semi-detached, terraced,
              flats) and by new-build versus existing homes, making comparisons more like-for-like.
            </Section>

            <button
              type="button"
              onClick={() => setDescriptionPage(2)}
              style={{
                marginTop: 12,
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              Next page
            </button>
          </>
        )}

        {descriptionPage === 2 && (
          <>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 8, marginBottom: 10 }}>
              Page 2 of 2
            </div>
            <Section title="4) Interpretation and use case">
              This grid-based view is useful for people researching a move, comparing affordability
              between regions, or understanding how prices change with distance from city centres.
              Because grid cells are consistent in size, they avoid some distortions caused by
              postcode areas, which can vary widely in shape and population.
            </Section>

            <Section title="5) Tooling added in this build">
              The map now includes postcode search, one-shot “Locate me” context, optional flood
              overlay, and a mobile clean-screen toggle to reduce UI clutter when the map needs full
              focus. These features are intended to support exploration, not replace official checks.
            </Section>

            <Section title="6) Flood overlay caveat (important)">
              Flood overlay uses open flood data and representative mapped points. Data may be
              incomplete or out of date in some postcodes, and different points within the same
              postcode can map to different flood areas. Always verify with official UK government
              sources before making decisions.
            </Section>

            <Section title="7) Scope and limitations">
              The map is an exploratory tool rather than a listing or valuation service. All shown
              data is aggregated and anonymised. The aim is to help patterns emerge clearly, not to
              predict prices or provide legal/financial advice.
            </Section>

            <button
              type="button"
              onClick={() => setDescriptionPage(1)}
              style={{
                marginTop: 12,
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              Previous page
            </button>
          </>
        )}

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
