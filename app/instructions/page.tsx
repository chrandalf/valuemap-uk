import BackToMapChip from "../components/BackToMapChip";

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
          How to use the current map features and interpret results.
        </p>

        <Section title="1) Start with controls">
          Start with Grid and Metric, then set property Type and New build to keep comparisons
          like-for-like. For broad scanning, use 10km/25km first, then move to 5km/1km for local
          detail.
        </Section>

        <Section title="2) Use Find my area when you have preferences">
          Open Find my area, set budget and importance sliders, then score cells to generate a
          green-to-red match map. After scoring, use the Area match filter in the right panel to
          focus on only stronger or weaker matches.
        </Section>

        <Section title="3) Understand overlays and coverage limits">
          Flood, school, and vote overlays are contextual. Flood and school data currently has
          England-focused coverage in this build, so treat cross-border areas carefully and verify
          with official sources.
        </Section>

        <Section title="4) Search, locate, and postcode actions">
          Use postcode search or Locate me for one-shot local context. Clicking cell postcodes opens
          Zoopla and now follows your active mode (including Find my area settings when scoring is
          active).
        </Section>

        <Section title="5) Mobile tips">
          Use the left quick dock for fast Grid/Metric switching and the Clear button to focus on
          the map. Returning from docs via Back to map now restores your last map state.
        </Section>

        <Section title="6) Read results carefully">
          Medians and deltas are strong for pattern detection, but still sensitive to sales mix and
          sample size. Use this as exploratory analysis, not formal valuation or legal/financial
          advice.
        </Section>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BackToMapChip />
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
