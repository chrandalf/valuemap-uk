"use client";

import BackToMapChip from "../components/BackToMapChip";

export default function DescriptionPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0c14", color: "white", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2 }}>Property Price Map UK, what it does and how to use it</h1>
          <p style={{ marginTop: 8, opacity: 0.72, fontSize: 14, lineHeight: 1.5 }}>
            Property Price Map UK helps you spot house price patterns across the whole country, then narrow down to the exact areas worth viewing. It combines sold price data with useful overlays like flood risk, schools, crime, demographics, and more.
          </p>
        </div>

        {/* ── SECTION 1: PRICE MAP ── */}
        <GroupHeading title="1. Price map, grid based, not postcode based" />

        <Section title="Why a grid helps">
          <p>The map divides the UK into equal-sized square cells rather than using postcode or local authority boundaries. Grid cells make price patterns directly comparable across the country — a cell in Cornwall covers exactly the same area as a cell in Yorkshire. Boundaries don&apos;t follow postcodes or council borders, so you can see price gradients without administrative lines getting in the way.</p>
        </Section>

        <Section title="Choose your grid size">
          <ul>
            <li><strong>25 km</strong> — national overview. Good for spotting broad regional price divides and the London premium.</li>
            <li><strong>10 km</strong> — regional. City hinterlands, satellite towns, and commuter belts.</li>
            <li><strong>5 km</strong> — local. Individual towns and their variation. The smallest size that shows price change over time.</li>
            <li><strong>1 km</strong> — neighbourhood detail. Use this to narrow down specific streets once you&apos;ve shortlisted an area.</li>
          </ul>
        </Section>

        <Section title="Price views">
          <ul>
            <li><strong>Median price</strong> — the middle sold price for all transactions in a cell. Reliable and outlier-resistant.</li>
            <li><strong>£/ft²</strong> — price per square foot using EPC-registered floor areas. Lets you compare flat-heavy areas with house-dominated ones on a like-for-like basis. England only.</li>
            <li><strong>Change £</strong> — absolute price movement over the selected period. Shows where prices have moved most in cash terms.</li>
            <li><strong>Change %</strong> — percentage price movement. Normalises for price level, so a 20% rise in a £150k area is directly comparable to 20% in a £500k area. Available at 5 km and above only.</li>
          </ul>
        </Section>

        <Section title="Filters to keep comparisons fair">
          <ul>
            <li><strong>Property type</strong> — filter by Detached, Semi-detached, Terraced, Flat, or any combination. Mixing types distorts medians, so filter when comparing like with like.</li>
            <li><strong>New build</strong> — new builds typically carry a 5–20% premium. Switch to Existing only to strip that out.</li>
            <li><strong>Period</strong> — narrow the date window for a more current picture, widen it for a larger sample.</li>
            <li><strong>Threshold</strong> — hide cells above or below a price. Removes unaffordable areas from view so you can focus on realistic zones.</li>
          </ul>
        </Section>

        {/* ── SECTION 2: FIND MY AREA ── */}
        <GroupHeading title="2. Find My Area, your priorities turned into a match score" />

        <Section title="How it works">
          <p>Find My Area converts your personal priorities into a single match score for every 1 km cell in the UK. Tell it what matters to you — affordability, flood safety, schools, transport, crime, community age — and it colours the whole map by how well each area fits. Green is a good match, red is a poor one.</p>
          <ul>
            <li>Each criterion you activate contributes a 0–1 component score.</li>
            <li>Scores are combined as a weighted average using the importance level you set: Off, Nice to have, Want, or Must have.</li>
            <li>A veto effect applies when a criterion you care strongly about scores very badly — a flood-prone or unaffordable area won&apos;t be rescued by great schools.</li>
          </ul>
        </Section>

        <Section title="What you can score on">
          <ul>
            <li><strong>💰 Affordability</strong> — set your budget. Cells near or over budget score lower; cells well within budget score higher. Hard veto if a cell is significantly over budget.</li>
            <li><strong>🌊 Flood safety</strong> — proportion of flood-risk points in the cell. England only.</li>
            <li><strong>🏫 Secondary school</strong> — average GCSE grade score of secondary schools within reach (Ofsted ratings also linked). England only.</li>
            <li><strong>🏫 Primary school nearby</strong> — proximity to the nearest primary school. England only.</li>
            <li><strong>🚂 Train station</strong> — distance to nearest station. Great Britain.</li>
            <li><strong>👥 Community age</strong> — resident age profile. Choose Younger or Older to indicate which suits you. UK-wide.</li>
            <li><strong>🚔 Crime safety</strong> — crime rate relative to the surrounding area. England and Wales.</li>
          </ul>
        </Section>

        <Section title="Score popup breakdown">
          <p>Hover or tap any scored cell to see a breakdown of what&apos;s driving the score — a bar for each active criterion, its importance weight, and a flag where data isn&apos;t available for that cell.</p>
        </Section>

        <Section title="Area match filter">
          <p>Once Find My Area is running, an Area match slider appears. Drag it to show only cells above (or below) a threshold — 60% and above shows only good matches, below 40% reveals areas that score poorly on your criteria.</p>
        </Section>

        {/* ── SECTION 3: OVERLAYS ── */}
        <GroupHeading title="3. Overlays, add context on top of prices" />

        <Section title="🌊 Flood risk">
          <ul>
            <li>Source: Environment Agency Flood Risk Register.</li>
            <li>Each dot represents a postcode-level flood risk point, coloured by severity.</li>
            <li>Turn on alongside the price grid to cross-reference, or use hide-cells mode to focus on flood geography alone.</li>
            <li>England only.</li>
          </ul>
        </Section>

        <Section title="🏫 Schools">
          <ul>
            <li>Source: Ofsted inspection data.</li>
            <li>Dots coloured by rating: Outstanding (dark green), Good (green), Requires Improvement (amber), Inadequate (red).</li>
            <li>Secondary and primary layers can be toggled independently.</li>
            <li>England only.</li>
          </ul>
        </Section>

        <Section title="🔴 Crime">
          <ul>
            <li>Source: Police UK open crime data, aggregated to LSOA level.</li>
            <li><strong>Absolute mode</strong> — colour based on national crime rate per 1,000 residents. Comparable city to city.</li>
            <li><strong>Relative mode</strong> — colour normalised against the local area. Highlights safer and less-safe pockets relative to nearby areas rather than national averages.</li>
            <li>Tap a dot for a breakdown by crime type: violent, property, anti-social behaviour, and other.</li>
            <li>England and Wales.</li>
          </ul>
        </Section>

        <Section title="👥 Community age">
          <ul>
            <li>Source: Census 2021.</li>
            <li>Cells coloured by mean resident age. Useful for understanding whether an area skews young, family, or retired.</li>
            <li>UK-wide.</li>
          </ul>
        </Section>

        <Section title="🗳️ GE2024 votes">
          <ul>
            <li>Source: Electoral Commission, General Election 2024.</li>
            <li>Red tones indicate stronger Labour/left vote share; blue/teal tones indicate stronger Conservative/Reform vote share.</li>
            <li>Relative mode normalises against the whole country; absolute mode shows raw vote-share percentages.</li>
            <li>Data is at constituency level, so cells near boundaries share the same colour across a wide area.</li>
          </ul>
        </Section>

        {/* ── SECTION 4: SEARCH & NAVIGATION ── */}
        <GroupHeading title="4. Search and navigation" />

        <Section title="Postcode search">
          <p>Type any full or partial UK postcode and press Go. The map flies to that location and shows the cell&apos;s price data, any active overlay values, and — if Find My Area is running — the match score and criterion breakdown.</p>
        </Section>

        <Section title="Right-click area lookup">
          <p>Right-click (or double-click on mobile) anywhere on the map to look up that exact location — useful for checking a specific street or address without knowing the postcode.</p>
        </Section>

        <Section title="📍 Locate me">
          <p>Uses your device&apos;s GPS to fly to your current location and show the same context popup. Handy when visiting a candidate area in person — get an instant read on what the data says about where you&apos;re standing.</p>
        </Section>

        <Section title="Zoopla links">
          <p>Click or tap any coloured cell to open a postcode list for that cell. Each postcode links directly to Zoopla so you can cross-reference map patterns with live asking prices and available stock.</p>
        </Section>

        {/* ── SECTION 5: DATA & CAVEATS ── */}
        <GroupHeading title="5. Data sources, coverage, and important caveats" />

        <Section title="Sold price data">
          <ul>
            <li>Source: HM Land Registry Price Paid data (England &amp; Wales) and Registers of Scotland.</li>
            <li>These are completed sale prices, not asking prices or valuations.</li>
            <li>Cells with very few transactions are suppressed to avoid misleading results from single sales.</li>
            <li>Scotland coverage is partial and may lag England &amp; Wales by several months. Northern Ireland is not included.</li>
          </ul>
        </Section>

        <Section title="Coverage by feature">
          <ul>
            <li><strong>Price grid (median, change)</strong> — England ✅, Wales ✅, Scotland ✅ (partial)</li>
            <li><strong>Price per ft²</strong> — England ✅, Wales ❌, Scotland ❌</li>
            <li><strong>Flood risk</strong> — England ✅, Wales ❌, Scotland ❌</li>
            <li><strong>Schools</strong> — England ✅, Wales ❌, Scotland ❌</li>
            <li><strong>Crime overlay</strong> — England ✅, Wales ✅, Scotland ❌</li>
            <li><strong>Community age</strong> — England ✅, Wales ✅, Scotland ✅</li>
            <li><strong>GE2024 votes</strong> — England ✅, Wales ✅, Scotland ✅</li>
            <li><strong>Train stations</strong> — England ✅, Wales ✅, Scotland ✅</li>
          </ul>
        </Section>

        <Section title="Important limitations">
          <ul>
            <li>This is an exploratory tool, not a valuation or professional advice service. Use it to identify patterns and shortlist areas, then verify with official and professional sources before making any decisions.</li>
            <li>Grid-cell medians are aggregate statistics — a single 1 km cell may contain varied micromarkets. Always click through to postcodes and individual listings for ground truth.</li>
            <li>Flood, school, and crime scoring highlights patterns; it does not replace an Environmental Search, an Ofsted report, or a detailed police crime lookup.</li>
            <li>Election data reflects GE2024 results and will age as political conditions change.</li>
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
