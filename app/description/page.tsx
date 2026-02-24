"use client";

import { useState } from "react";
import BackToMapChip from "../components/BackToMapChip";

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
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>UK House Price Map — grid analysis with preference scoring</p>

        {descriptionPage === 1 && (
          <>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 8, marginBottom: 10 }}>
              Page 1 of 2
            </div>
            <Section title="1) Why grid-based?">
              This map shows price patterns using fixed 1km–25km cells rather than postcode averages.
              Equal-sized cells make regional gradients, local hotspots, and edge effects much easier
              to compare across the UK.
            </Section>

            <Section title="2) What metrics are available">
              Core metrics include median price, median £/ft², and change views (GBP and %).
              Medians are calculated from transaction data and are designed to be robust against
              outliers compared with simple averages.
            </Section>

            <Section title="3) Controls, filters, and scoring">
              Use Grid, Metric, Type, New build, and Period filters for like-for-like comparisons.
              Find my area adds weighted preference scoring (affordability, flood safety, schools)
              and provides an Area match filter to focus on top or lower matches.
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
            <Section title="4) Search and practical exploration">
              Postcode search and one-shot Locate me add local context quickly. Clicking postcode
              chips opens external listings so you can move from map patterns to live market checks.
            </Section>

            <Section title="5) Overlay suite in this build">
              The app includes flood, school-quality, and GE2024 vote overlays. Overlays are
              intended for contextual comparison with price patterns, not as standalone decision
              tools.
            </Section>

            <Section title="6) Mobile and navigation upgrades">
              Mobile quick controls and clean-screen mode improve map-first use on small devices.
              Returning from docs now restores the previous map state instead of resetting filters.
            </Section>

            <Section title="7) Coverage caveat (important)">
              Flood and school layers currently rely on England-focused coverage in this build.
              Treat Wales and Scotland results cautiously until broader datasets are integrated.
            </Section>

            <Section title="8) Scope and limitations">
              This is an exploratory map, not a valuation or advice service. Use it to identify
              patterns and shortlist areas, then verify details with official and professional
              sources.
            </Section>

            <Section title="9) Political vote colour scale (relative vs absolute)">
              The political vote overlay uses a left-to-right colour gradient: red tones indicate
              relatively stronger left-leaning vote share, blue tones indicate relatively stronger
              right-leaning vote share. In <b>Relative</b> mode, colours are normalised against the
              currently loaded map cells, so local stand-out areas are emphasised even when raw
              percentages are low nationally. In <b>Absolute</b> mode, colours are based on raw vote
              shares in each cell, giving a direct percentage-based view.
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
          <BackToMapChip />
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
