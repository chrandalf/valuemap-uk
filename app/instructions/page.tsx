"use client";
import BackToMapChip from "../components/BackToMapChip";

export default function InstructionsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0c14", color: "white", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2 }}>How to use the map</h1>
          <p style={{ marginTop: 8, opacity: 0.72, fontSize: 14, lineHeight: 1.5 }}>
            There are two ways to use this tool. <strong>Find My Area</strong> scores the entire UK map against your personal priorities in
            one click. <strong>Manual exploration</strong> lets you drill into price data, overlays, and local context at your own pace.
            Most users benefit from doing both — start with Find My Area to surface candidate regions, then switch to manual mode to
            interrogate those areas in detail.
          </p>
          <p style={{ marginTop: 6, opacity: 0.55, fontSize: 12 }}>
            💡 Tap <strong>Show me</strong> on the map for a hands-on guided tour.
          </p>
        </div>

        {/* ── PATHWAY A ── */}
        <PathHeading letter="A" color="#a78bfa" title="Find My Area — let the map score everywhere for you" />

        <p style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.6, marginTop: 8, marginBottom: 14 }}>
          Find My Area lets you describe what matters to you — budget, safety from flooding,
          school quality, commuting, crime, community character — and instantly colours every 1 km cell in the UK
          from <GreenDot /> green (great match) through <YellowDot /> amber to <RedDot /> red (poor match).
          It is the fastest way to go from &ldquo;I don&apos;t know where to start&rdquo; to a shortlist of real candidate areas.
          Open it via <strong>⚙ Controls → 🔍 Find my area</strong>.
        </p>

        <Section title="Step 1 — Set your budget and property type">
          <ul>
            <li>Enter your <strong>target budget</strong> (the median price you are aiming for in a cell — not the max you can technically afford).</li>
            <li>Choose a <strong>property type</strong>: All types, Detached, Semi-detached, Terraced, or Flat. This controls which price data is used when scoring affordability.</li>
          </ul>
        </Section>

        <Section title="Step 2 — Set importance weights">
          <p style={{ marginBottom: 8 }}>For each criterion, pick <strong>Off · Nice · Want · Must</strong> (internally 0 · 3 · 6 · 10). You only need to turn on the things that genuinely matter to you.</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ opacity: 0.55, textAlign: "left" }}>
                <th style={{ paddingBottom: 6, fontWeight: 600 }}>Criterion</th>
                <th style={{ paddingBottom: 6, fontWeight: 600 }}>What it measures</th>
                <th style={{ paddingBottom: 6, fontWeight: 600 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["💰 Affordability", "How the cell's typical price compares to your budget", "Scored 0 (way over budget) → 1 (well under). Budget-busting areas get a hard veto drag."],
                ["🌊 Flood safety", "Proportion of flood-risk properties in the cell", "England only. Cells with no flood data are treated as neutral."],
                ["🏫 Schools (secondary)", "Average GCSE grade score of secondary schools within reach", "England only. Ofsted ratings also linked."],
                ["🏫 Primary school nearby", "Walking distance to the nearest primary school", "England only. Closer = higher score."],
                ["🚂 Train station", "Distance to the nearest rail station", "Covers GB mainline and commuter rail. Closer = higher score."],
                ["👥 Community age", "Census age-mix of residents in the cell", "Use the Younger / Older dropdown to say which direction you prefer."],
                ["🚔 Crime safety", "Crime rate relative to the surrounding local area", "Police-recorded data. Relative scoring — a low-crime street in a higher-crime borough can still score well."],
              ] as [string, string, string][]).map(([criterion, what, notes]) => (
                <tr key={criterion} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <td style={{ padding: "6px 8px 6px 0", fontWeight: 600, whiteSpace: "nowrap" }}>{criterion}</td>
                  <td style={{ padding: "6px 8px", opacity: 0.82 }}>{what}</td>
                  <td style={{ padding: "6px 0 6px 8px", opacity: 0.6, fontSize: 12 }}>{notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Step 3 — Score areas">
          <ul>
            <li>Press <Kbd>Score areas</Kbd>. The map switches to 1 km grid and repaints every cell.</li>
            <li>Colours run from <GreenDot /> dark green (≥ 80% match) through amber to <RedDot /> red (poor match).</li>
            <li>Grey / transparent cells have a score below the suitability threshold or insufficient data.</li>
            <li>Hover or tap any cell to see a <strong>score breakdown popup</strong> showing each criterion&apos;s weighted bar, score %, and any no-data flags.</li>
          </ul>
        </Section>

        <Section title="Step 4 — Narrow down with the Area match filter">
          <ul>
            <li>Use the <strong>Area match</strong> slider (right panel) to hide cells below a threshold — e.g. 60% hides everything scoring under 60.</li>
            <li>Toggle <strong>≥ threshold</strong> (show only good matches) or <strong>≤ threshold</strong> (show only poor matches — useful for ruling zones out).</li>
            <li>The map now highlights a much smaller cluster of high-scoring areas — these are your candidate regions.</li>
          </ul>
        </Section>

        <Section title="Step 5 — Drill in">
          <ul>
            <li>Zoom into a green cluster. Click a cell to see postcodes inside it — each links directly to <strong>Zoopla listings</strong>.</li>
            <li>Switch to manual mode (1 km grid, Median or £/ft²) to see actual prices alongside the score shading.</li>
            <li>Toggle overlays (flood zones, school dots, crime dots) to spot any localised risks within a promising area.</li>
            <li>Use <Kbd>📍 Locate me</Kbd> or type a postcode to get a popup showing the cell score plus nearby schools, flood risk, and crime data at that exact point.</li>
          </ul>
        </Section>

        <CalloutBox color="#a78bfa" label="Example A — Family, school-age children, £450k, needs trains to London">
          <p><strong>Settings:</strong> Budget £450,000 · Detached or Semi · Affordability = Want · Flood = Nice · Schools (secondary) = Must · Primary = Want · Train = Must · Crime = Nice</p>
          <p><strong>Result:</strong> High-scoring cells cluster in commuter towns 30–60 min outside London — parts of Hertfordshire, Essex, north Kent, and south Cambridgeshire emerge as green. The Area match filter at ≥ 65% reduces this to a tight band where all four criteria converge.</p>
          <p><strong>Next step:</strong> Zoom into a green cluster in Hertfordshire. Click cells to see postcodes. Toggle the Schools overlay to see which specific secondary schools are nearby. Open Zoopla for one postcode to sense-check what £450k actually buys there.</p>
        </CalloutBox>

        <CalloutBox color="#60a5fa" label="Example B — Young professional, flat, low crime, easy commute, £280k">
          <p><strong>Settings:</strong> Budget £280,000 · Flat · Affordability = Must · Train = Must · Crime = Must · Schools = Off · Community age = Nice (Younger)</p>
          <p><strong>Result:</strong> Affordable flat stock with good rail access and low relative crime points toward outer London zones, Greater Manchester, and some Yorkshire cities. Cells near major terminals with newer flat stock score highest.</p>
          <p><strong>Next step:</strong> Set Area match ≥ 70%. Click a high-scoring cell in south Manchester. The score popup shows Crime safety 78%, Train 95%, Affordability 62%. Switch on the Crime overlay to check surrounding LSOA detail — confirm the low crime score is not averaged from a patchwork.</p>
        </CalloutBox>

        <CalloutBox color="#22c55e" label="Example C — Retiring couple, rural, flood-safe, no commute pressure, £600k">
          <p><strong>Settings:</strong> Budget £600,000 · Detached · Affordability = Nice · Flood = Must · Schools = Off · Train = Off · Crime = Want · Community age = Want (Older)</p>
          <p><strong>Result:</strong> High-scoring cells avoid flood plains. Rural areas of Shropshire, Wiltshire, and parts of the Peak District score well. The veto multiplier means a flood-heavy cell near a river scores very low regardless of other strengths.</p>
          <p><strong>Next step:</strong> Toggle the Flood overlay (hide cells mode) to make flood risk geography directly visible. Cross-reference green Find My Area cells with flood-free zones to confirm the scoring matches the map.</p>
        </CalloutBox>

        <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "28px 0" }} />

        {/* ── PATHWAY B ── */}
        <PathHeading letter="B" color="#facc15" title="Manual exploration — browse, filter, and overlay at your own pace" />

        <p style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.6, marginTop: 8, marginBottom: 14 }}>
          Manual mode gives you direct control over every layer of the map. Use it to understand regional price gradients,
          spot momentum trends, compare local areas side by side, or verify findings from Find My Area with raw data.
        </p>

        <Section title="Grid size — start wide, zoom narrow">
          <ul>
            <li><strong>25 km</strong> — national overview. Shows broad regional patterns and north/south divides.</li>
            <li><strong>10 km</strong> — regional level. City catchment areas and commuter belt edges become clear.</li>
            <li><strong>5 km</strong> — local level. Individual towns and their price gradients. Change (delta) metrics available from here upward.</li>
            <li><strong>1 km</strong> — neighbourhood level. Street-by-street variation. Best for comparing specific postcodes.</li>
          </ul>
          <p style={{ marginTop: 6, opacity: 0.7, fontSize: 13 }}>Start at 10 km for context, then zoom and switch to 1 km once you know roughly where to look.</p>
        </Section>

        <Section title="Metrics">
          <ul>
            <li><strong>Median price</strong> — middle sale price in a cell. Robust against outliers. Best for general comparisons.</li>
            <li><strong>Price per ft² (£/ft²)</strong> — normalises for property size. Better for comparing a city flat market with a village houses market. England only (requires EPC floor-area data).</li>
            <li><strong>Change GBP / Change %</strong> — price movement from earliest to latest period in the selected date range. Shows momentum. Available at 5 km+.</li>
          </ul>
        </Section>

        <Section title="Filters">
          <ul>
            <li><strong>Property type</strong> — All, Detached, Semi-detached, Terraced, Flat. Filtering by type is essential for fair comparisons.</li>
            <li><strong>New build</strong> — All, New build only, Existing only. New builds often carry a premium; filter to Existing for resale comparisons.</li>
            <li><strong>Period</strong> — choose a date range. Combine with Change metric to see whether prices rose or fell within your window.</li>
            <li><strong>Value filter</strong> — hide cells above or below a price threshold. Quickly masks out unaffordable areas.</li>
          </ul>
        </Section>

        <Section title="Overlay layers">
          <p style={{ marginBottom: 8 }}>Open <Kbd>Overlay filters</Kbd> (bottom-right panel) to add contextual data on top of the price grid:</p>
          <ul>
            <li>
              <strong>🌊 Flood risk</strong> — Environment Agency flood risk points (England).
              <em> On</em> shows dots over price cells. <em>On (hide cells)</em> removes the price grid so only flood risk is visible.
            </li>
            <li style={{ marginTop: 6 }}>
              <strong>🏫 Schools</strong> — Ofsted-rated secondary and primary schools (England). Dot colours indicate rating band. Toggle secondary and primary independently.
            </li>
            <li style={{ marginTop: 6 }}>
              <strong>🔴 Crime</strong> — LSOA-level police-recorded crime density. Two sub-modes:
              <ul style={{ marginTop: 4 }}>
                <li><em>Absolute</em> — raw crime rate per 1,000 residents nationally.</li>
                <li><em>Relative</em> — normalised against the local area. Useful for spotting safer pockets relative to surrounding areas rather than national averages.</li>
              </ul>
              Hover a dot for a breakdown by type: violent, property, ASB, and other.
            </li>
            <li style={{ marginTop: 6 }}>
              <strong>👥 Age mix</strong> — census mean age per cell. Shows where communities skew younger or older.
            </li>
            <li style={{ marginTop: 6 }}>
              <strong>🗳️ GE2024 Vote overlay</strong> — constituency-level General Election 2024 vote shares. Colour scale: Labour red → swing seats → Conservative/Reform blue.
              <ul style={{ marginTop: 4 }}>
                <li><em>Relative mode</em> — colour normalised against the whole country. Emphasises regional variation nationally.</li>
                <li><em>Absolute mode</em> — raw vote share percentages for national comparisons.</li>
              </ul>
            </li>
          </ul>
        </Section>

        <Section title="Search and location tools">
          <ul>
            <li><strong>Postcode search</strong> — type any full or partial postcode and press <Kbd>Go</Kbd>. The map flies to that area and shows the price cell, local flood/school/crime context, and an index score if scoring is active.</li>
            <li><strong>📍 Locate me</strong> — uses your device GPS. Shows the cell you are in, nearby schools, flood risk, and — if Find My Area is active — your location&apos;s score. Useful for on-the-ground checks when visiting a candidate area.</li>
            <li><strong>Click any cell</strong> — opens a list of postcodes within that cell. Each is a direct link to Zoopla so you can cross-reference with live listings.</li>
          </ul>
        </Section>

        <Section title="Tips for combining both modes">
          <ol>
            <li>Run <strong>Find My Area</strong> at a national level to identify 2–3 candidate regions.</li>
            <li>Switch to <strong>manual mode</strong>, zoom into each region at 5 km, and check Change % to see which has price momentum in your favour.</li>
            <li>Toggle <strong>Crime overlay (Relative)</strong> within a promising area to spot the safer pockets.</li>
            <li>Toggle <strong>Flood overlay</strong> to rule out flood-plain pockets.</li>
            <li>Zoom to <strong>1 km grid</strong> and check <strong>£/ft²</strong> to compare value for money between streets.</li>
            <li>Right-click a high-scoring, flood-safe, low-crime cell → click a postcode → open Zoopla to reality-check asking prices.</li>
            <li>Use <Kbd>📍 Locate me</Kbd> if you visit the area for an instant on-the-ground score check.</li>
          </ol>
        </Section>

        <div style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BackToMapChip />
          <NavChip href="/description">Full feature reference</NavChip>
          <NavChip href="/data-sources">Data sources</NavChip>
          <NavChip href="/election-info">Election info</NavChip>
        </div>
      </div>
    </main>
  );
}

function PathHeading({ letter, color, title }: { letter: string; color: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, marginBottom: 4 }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: color + "28", border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color, flexShrink: 0 }}>{letter}</div>
      <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.3 }}>{title}</h2>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "rgba(255,255,255,0.95)" }}>{title}</div>
      <div style={{ opacity: 0.88, fontSize: 14, lineHeight: 1.65 }}>{children}</div>
    </section>
  );
}

function CalloutBox({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14, border: `1px solid ${color}40`, background: `${color}0f`, borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontWeight: 700, fontSize: 13, color, marginBottom: 8 }}>🧭 {label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.65, opacity: 0.88 }}>{children}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 5, padding: "1px 6px", fontSize: "0.92em", fontFamily: "monospace", whiteSpace: "nowrap" }}>{children}</span>
  );
}

function GreenDot() { return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#22c55e", verticalAlign: "middle", marginRight: 3 }} />; }
function YellowDot() { return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#facc15", verticalAlign: "middle", marginRight: 3 }} />; }
function RedDot() { return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#ef4444", verticalAlign: "middle", marginRight: 3 }} />; }

function NavChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "white", textDecoration: "none", fontSize: 12 }}>{children}</a>
  );
}
