"use client";

import BackToMapChip from "../components/BackToMapChip";

export default function DescriptionPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0c14", color: "white", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 900, margin: "0 auto" }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2 }}>Feature reference</h1>
          <p style={{ marginTop: 8, opacity: 0.72, fontSize: 14, lineHeight: 1.5 }}>
            A complete audit of everything ValueMap UK does — what each feature is, how it works, and where the data comes from.
          </p>
        </div>

        {/* ── SECTION 1: PRICE GRID ── */}
        <GroupHeading title="1. Price grid" />

        <Section title="Why grid-based?">
          <p>The map divides the UK into equal-sized square cells (1 km, 5 km, 10 km, or 25 km) rather than using postcode or local authority boundaries. Fixed-size cells have two key advantages:</p>
          <ul>
            <li>Price gradients are directly comparable across the country \u2014 a 5 km cell in Cornwall covers the same area as a 5 km cell in Yorkshire.</li>
            <li>Cell edges do not align with administrative boundaries, so urban/rural transitions and catchment-area effects are easier to spot visually.</li>
          </ul>
        </Section>

        <Section title="Grid sizes">
          <ul>
            <li><strong>25 km</strong> \u2014 national overview. Identifies broad macro-regions and price divides (e.g. London premium, north/south gradient).</li>
            <li><strong>10 km</strong> \u2014 regional. City hinterlands, satellite towns, and commuter belts become visible.</li>
            <li><strong>5 km</strong> \u2014 local. Individual towns and their neighbourhood variation. The smallest grid that supports Change (delta) metrics.</li>
            <li><strong>1 km</strong> \u2014 neighbourhood. Street-level detail. Best for narrowing down specific postcodes within a shortlisted area.</li>
          </ul>
        </Section>

        <Section title="Metrics">
          <ul>
            <li><strong>Median price</strong> \u2014 the middle sold price across all transactions in a cell. Robust against outlier sales. The most reliable general indicator.</li>
            <li><strong>Price per ft\u00b2 (\u00a3/ft\u00b2)</strong> \u2014 median \u00a3/ft\u00b2 using registered floor areas from EPC records. Normalises for property size, allowing fairer like-for-like comparisons between flat-heavy city centres and house-dominated suburbs. <em>England only.</em></li>
            <li><strong>Change GBP</strong> \u2014 absolute price change (latest minus earliest) across the selected period. Shows which areas have moved the most in monetary terms.</li>
            <li><strong>Change %</strong> \u2014 percentage price change across the selected period. Normalises for absolute price level, so a 20% rise in a \u00a3150k area is directly comparable with a 20% rise in a \u00a3500k area. <em>Available at 5 km+ only.</em></li>
          </ul>
        </Section>

        <Section title="Filters">
          <ul>
            <li><strong>Property type</strong> \u2014 All, Detached (D), Semi-detached (S), Terraced (T), Flat (F), or a custom multi-select combination. Essential for fair comparisons: a cell with mostly flats will appear cheap if you are looking at mixed-type medians.</li>
            <li><strong>New build</strong> \u2014 All transactions, New build only, or Existing properties only. New builds in the UK typically carry a 5\u201320% premium; use Existing to strip this out.</li>
            <li><strong>Period</strong> \u2014 the date window for transactions. Narrowing the window reduces sample size but gives a more current picture; widening it improves statistical stability.</li>
            <li><strong>Value filter</strong> \u2014 hides cells above or below a price threshold. Quickly removes unaffordable areas from the visual field so you can focus attention on realistic zones.</li>
          </ul>
        </Section>

        {/* ── SECTION 2: FIND MY AREA ── */}
        <GroupHeading title="2. Find My Area \u2014 weighted preference scoring" />

        <p style={{ fontSize: 14, opacity: 0.82, lineHeight: 1.6, marginTop: 8, marginBottom: 4 }}>
          Find My Area converts your personal priorities into a single 0\u2013100% match score for every 1 km cell in the UK.
          It is the fastest way to identify candidate regions without prior knowledge of where to look.
        </p>

        <Section title="How the scoring works">
          <ul>
            <li>Each active criterion contributes a <strong>0\u20131 component score</strong> (0 = worst, 1 = best for that factor).</li>
            <li>Component scores are combined as a <strong>weighted average</strong> using the importance weights you set (Off = 0, Nice = 3, Want = 6, Must = 10).</li>
            <li>A <strong>veto multiplier</strong> applies a drag when a criterion you care about scores badly. A factor at weight=10 with a score of 0 (absolute worst) can drive the overall score to zero regardless of how well other criteria perform. This prevents a great school from masking an unaffordable or flood-prone area.</li>
            <li>The final score (0\u20131) is painted onto the 1 km cell grid as a colour from dark green (\u226580%) through amber (\u224850%) to red (\u226430%).</li>
          </ul>
        </Section>

        <Section title="Scoring criteria">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ opacity: 0.5 }}>
                <th style={{ textAlign: "left", paddingBottom: 6 }}>Criterion</th>
                <th style={{ textAlign: "left", paddingBottom: 6 }}>Data source</th>
                <th style={{ textAlign: "left", paddingBottom: 6 }}>How scored</th>
                <th style={{ textAlign: "left", paddingBottom: 6 }}>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["\ud83d\udcb0 Affordability", "Land Registry sold prices", "Budget vs cell median. 0 = 60%+ over budget, 1 = 40%+ under budget. Hard veto above budget.", "UK-wide"],
                ["\ud83c\udf0a Flood safety", "Environment Agency", "Proportion of flood-risk points in cell. 0 = high risk, 1 = no risk.", "England only"],
                ["\ud83c\udfeb Schools (secondary)", "Ofsted ratings", "Average inspection score of secondary schools within reach. 0 = poor, 1 = outstanding.", "England only"],
                ["\ud83c\udfeb Primary school nearby", "Ofsted + walking distance", "Proximity to nearest primary. Scored by distance \u2014 shorter = higher score.", "England only"],
                ["\ud83d\ude82 Train station", "National Rail station data", "Distance to nearest station. Scored continuously by km. No-data = neutral.", "Great Britain"],
                ["\ud83d\udc65 Community age", "Census 2021 age scores", "Age distribution of residents in the cell. Choose Younger or Older to say which direction suits you.", "UK-wide"],
                ["\ud83d\ude94 Crime safety", "Police-recorded crime (LSOA)", "Crime rate relative to the surrounding local area. Highest score = lowest crime relative to local surroundings.", "England & Wales"],
              ] as [string, string, string, string][]).map(([c, s, h, cv]) => (
                <tr key={c} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <td style={{ padding: "6px 8px 6px 0", fontWeight: 600 }}>{c}</td>
                  <td style={{ padding: "6px 8px", opacity: 0.7, fontSize: 12 }}>{s}</td>
                  <td style={{ padding: "6px 8px", opacity: 0.82, fontSize: 12 }}>{h}</td>
                  <td style={{ padding: "6px 0 6px 8px", opacity: 0.6, fontSize: 12 }}>{cv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Score popup">
          <p>Hovering or tapping any scored cell shows a <strong>per-criterion breakdown popup</strong> with:</p>
          <ul>
            <li>A colour-coded progress bar showing the component score for each active criterion.</li>
            <li>The importance weight (×3, ×6, ×10) shown next to each row.</li>
            <li>A percentage score so you can see exactly why an area is dragging down the total.</li>
            <li>A no-data indicator (\u274c) where the scoring dataset does not cover that cell.</li>
          </ul>
        </Section>

        <Section title="Area match filter">
          <ul>
            <li>After scoring, an <strong>Area match</strong> slider appears in the right panel. Drag it to set a threshold (e.g. 60%).</li>
            <li><strong>\u2265 threshold mode</strong> \u2014 hides cells below the threshold; only good matches remain visible.</li>
            <li><strong>\u2264 threshold mode</strong> \u2014 hides cells above the threshold; shows only poor matches (useful for ruling out zones).</li>
          </ul>
        </Section>

        {/* ── SECTION 3: OVERLAYS ── */}
        <GroupHeading title="3. Overlay layers" />

        <Section title="\ud83c\udf0a Flood risk">
          <ul>
            <li>Source: Environment Agency Flood Risk Register (England).</li>
            <li>Each dot represents a property-level flood risk point. Colour indicates severity band.</li>
            <li><strong>On mode</strong> \u2014 dots overlay the price grid for cross-reference.</li>
            <li><strong>On (hide cells) mode</strong> \u2014 price cells are hidden so flood risk geography is the primary focus.</li>
            <li>Coverage: England only. Not available for Wales or Scotland in this build.</li>
          </ul>
        </Section>

        <Section title="\ud83c\udfeb Schools (secondary &amp; primary)">
          <ul>
            <li>Source: Ofsted inspection data (England).</li>
            <li>School dots are coloured by inspection rating band: Outstanding (dark green), Good (green), Requires Improvement (amber), Inadequate (red).</li>
            <li>Toggle secondary and primary layers independently from the Overlay filters panel.</li>
            <li>Coverage: England only.</li>
          </ul>
        </Section>

        <Section title="\ud83d\udd34 Crime overlay">
          <ul>
            <li>Source: Police UK open crime data, aggregated to LSOA level.</li>
            <li>Each dot represents one LSOA (Lower Super Output Area). Colour and intensity indicate crime density.</li>
            <li>
              <strong>Absolute mode</strong> \u2014 colour based on national crime rate per 1,000 residents. Comparable city to city.
            </li>
            <li>
              <strong>Relative mode</strong> \u2014 colour normalised against the current map viewport. Highlights safer and less-safe pockets relative to the visible area. Useful when zoomed into a single city.
            </li>
            <li>Hovering or tapping a dot shows a breakdown by crime type: <strong>violent</strong>, <strong>property</strong>, <strong>anti-social behaviour (ASB)</strong>, and <strong>other</strong>, plus a total count.</li>
            <li>Coverage: England and Wales.</li>
          </ul>
        </Section>

        <Section title="\ud83d\udc65 Community age overlay">
          <ul>
            <li>Source: Census 2021.</li>
            <li>Each cell is coloured by mean resident age, from younger (blue-toned) to older (warm-toned).</li>
            <li>Useful for understanding the demographic character of an area — whether it feels more like a young professional neighbourhood or an established family / retirement community.</li>
            <li>Coverage: UK-wide.</li>
          </ul>
        </Section>

        <Section title="\ud83d\uddf3\ufe0f GE2024 Vote overlay">
          <ul>
            <li>Source: Electoral Commission \u2014 General Election 2024 constituency results.</li>
            <li>Colour scale: red tones = stronger Labour/left vote share. Blue/teal tones = stronger Conservative/Reform vote share. Swing seats appear neutral/purple.</li>
            <li>
              <strong>Relative mode</strong> \u2014 colour normalised to the current viewport. Emphasises local political variation within a region.
            </li>
            <li>
              <strong>Absolute mode</strong> \u2014 raw vote-share percentages. Better for comparing constituencies at a national level.
            </li>
            <li>Data is at constituency level (not ward or LSOA), so cells near constituency boundaries will reflect the same shade across a wide area.</li>
          </ul>
        </Section>

        {/* ── SECTION 4: SEARCH & NAVIGATION ── */}
        <GroupHeading title="4. Search and navigation" />

        <Section title="Postcode search">
          <ul>
            <li>Type any full or partial UK postcode and press <strong>Go</strong>.</li>
            <li>The map flies to that location. A popup appears showing the cell\u2019s price data, any active overlay values (flood risk, school, crime), and \u2014 if Find My Area is running \u2014 the cell\u2019s match score and per-criterion breakdown.</li>
          </ul>
        </Section>

        <Section title="\ud83d\udccd Locate me">
          <ul>
            <li>Uses your device&apos;s GPS to fly to your current location.</li>
            <li>Shows the same context popup as Postcode search: nearby flood risk, school, crime, and score.</li>
            <li>Particularly useful when visiting a candidate area in person \u2014 get an instant read of what the data says about where you&apos;re standing.</li>
          </ul>
        </Section>

        <Section title="Zoopla links">
          <ul>
            <li>Clicking or tapping any coloured cell opens a <strong>postcode list</strong> for that cell.</li>
            <li>Each postcode links directly to Zoopla so you can immediately cross-reference map patterns with live asking prices and available stock.</li>
          </ul>
        </Section>

        <GroupHeading title="5. Data, coverage, and caveats" />

        <Section title="Price data">
          <ul>
            <li>Source: HM Land Registry Price Paid data (England &amp; Wales) and Registers of Scotland (Scotland).</li>
            <li>Prices are <em>completed sale</em> prices, not asking prices or valuations.</li>
            <li>Medians are calculated per cell per period. Cells with fewer than ~5 transactions are suppressed to avoid misleading single-sale cells.</li>
            <li>Scotland coverage is partial and may lag England &amp; Wales by several months.</li>
            <li>Northern Ireland is not currently included.</li>
          </ul>
        </Section>

        <Section title="Coverage summary">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ opacity: 0.5 }}>
                <th style={{ textAlign: "left", paddingBottom: 6 }}>Layer</th>
                <th style={{ textAlign: "left", paddingBottom: 6 }}>England</th>
                <th style={{ textAlign: "left", paddingBottom: 6 }}>Wales</th>
                <th style={{ textAlign: "left", paddingBottom: 6 }}>Scotland</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["Price grid (median, change)", "\u2705", "\u2705", "\u2705 (partial)"],
                ["Price per ft\u00b2", "\u2705", "\u274c", "\u274c"],
                ["Flood risk", "\u2705", "\u274c", "\u274c"],
                ["Schools (secondary & primary)", "\u2705", "\u274c", "\u274c"],
                ["Crime overlay", "\u2705", "\u2705", "\u274c"],
                ["Community age", "\u2705", "\u2705", "\u2705"],
                ["GE2024 votes", "\u2705", "\u2705", "\u2705"],
                ["Train stations", "\u2705", "\u2705", "\u2705"],
              ] as [string, string, string, string][]).map(([layer, en, wa, sc]) => (
                <tr key={layer} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <td style={{ padding: "5px 8px 5px 0", fontWeight: 500 }}>{layer}</td>
                  <td style={{ padding: "5px 8px", opacity: 0.82 }}>{en}</td>
                  <td style={{ padding: "5px 8px", opacity: 0.82 }}>{wa}</td>
                  <td style={{ padding: "5px 8px", opacity: 0.82 }}>{sc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Important limitations">
          <ul>
            <li>This is an <strong>exploratory analysis tool</strong>, not a valuation or professional advice service. Use it to identify patterns and shortlist areas, then verify everything with official and professional sources before making decisions.</li>
            <li>Grid-cell medians are aggregate statistics. A single 1 km cell may contain varied micromarkets; always click through to postcodes and individual listings for ground truth.</li>
            <li>Flood, school, and crime scoring is designed to highlight patterns \u2014 not to substitute for an Environmental Search, school ofsted report, or police crime statistics lookup.</li>
            <li>Election data reflects GE2024 results, which will age as political conditions change.</li>
          </ul>
        </Section>

        <div style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BackToMapChip />
          <NavChip href="/instructions">How to use</NavChip>
          <NavChip href="/data-sources">Data sources</NavChip>
          <NavChip href="/legal">Legal</NavChip>
          <NavChip href="/privacy">Privacy</NavChip>
        </div>
      </div>
    </main>
  );
}

function GroupHeading({ title }: { title: string }) {
  return (
    <div style={{ marginTop: 28, marginBottom: 6, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{title}</div>
      <div style={{ opacity: 0.88, fontSize: 14, lineHeight: 1.65 }}>{children}</div>
    </section>
  );
}

function NavChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "white", textDecoration: "none", fontSize: 12 }}>
      {children}
    </a>
  );
}
