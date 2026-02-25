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
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>How to use the map</h1>
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>
          Two ways to explore: let the map find areas for you, or browse manually. Tap <b>Show me</b> on the map for a hands-on walkthrough.
        </p>

        <Section title="Option A — Find my area (recommended first step)">
          Open <b>⚙ Controls → 🔍 Find my area</b>. Set your budget, choose a property type, and
          drag the importance sliders for affordability, flood safety, and school quality. Press
          <b> Score areas</b> — the map switches to 1 km grid and colours every cell green (great
          match) through red (poor match). After scoring, use the <b>Area match filter</b> on the
          right to hide cells below or above a percentage threshold. Tap <b>Edit scoring</b> to
          refine, or <b>Clear</b> to go back to the standard map.
        </Section>

        <Section title="Option B — Explore manually">
          Use the <b>left-hand quick dock</b> to change Metric, Type, New build, Period, or Grid on
          the fly. Press the <b>→</b> arrow to cycle between categories then tap the option you
          want. For full control, open <b>⚙ Controls → 🗂 Filters</b> to see every parameter at
          once. Start at 10 km or 25 km for the big picture, then zoom and switch to 5 km or 1 km
          for local detail.
        </Section>

        <Section title="Metrics explained">
          <b>Median</b> = middle sold price. <b>Price/ft²</b> = median price per square foot (EPC
          floor-area data, England only). <b>Change (GBP)</b> and <b>Change (%)</b> compare the
          earliest period to the latest to show price momentum. Delta metrics are available at 5 km
          grid and above.
        </Section>

        <Section title="Overlay layers">
          Open the <b>Overlay filters</b> panel (bottom-right) to toggle <b>Flood</b>,{" "}
          <b>Schools</b>, and <b>Political votes</b>. Each overlay can be set to <i>On</i> (shows
          dots over cells) or <i>On (hide cells)</i> (hides the price grid so only overlay data is
          visible). Flood and school data currently covers England only. The vote overlay shows GE
          2024 constituency-level vote shares with a progressive / conservative / popular-right
          colour scale — toggle between <i>Relative</i> and <i>Absolute</i> to change shading.
        </Section>

        <Section title="Postcode search and Locate me">
          Type a postcode in the search bar (top-right on desktop, second row on mobile) and press
          <b> Go</b>. The map flies to that area and, if flood or school overlays are active, shows
          the nearest flood risk point and school. Press <b>📍 Locate</b> to use your GPS position
          for the same one-shot local check. Clicking any coloured cell on the map opens a postcode
          list — each postcode links to Zoopla so you can look at real listings.
        </Section>

        <Section title="Mobile tips">
          The left quick dock works just like the desktop filters. Press <b>Clear</b> (top-right) to
          hide all panels and focus on the map; press <b>Restore</b> to bring them back. The right
          panels collapse into compact chips — tap the chevron to expand them.
        </Section>

        <Section title="Reading results carefully">
          Prices are <i>sold</i> prices, not asking prices. Medians reduce outlier distortion but
          can still shift if the mix of homes sold changes. Scotland coverage is partial and may lag.
          Treat overlays as exploratory context — always verify with official sources before making
          any decisions.
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
