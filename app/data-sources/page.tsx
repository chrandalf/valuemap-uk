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
          All datasets currently used in this build. All open data — no proprietary feeds.
        </p>

        <Section label="Property prices">
          <Item>
            <b>HM Land Registry Price Paid Data</b> — sold price transactions for England &amp; Wales.
            Updated monthly. Open Government Licence v3.0.
          </Item>
          <Item>
            <b>Registers of Scotland</b> — sold price transactions for Scotland.
            Open Government Licence v3.0.
          </Item>
          <Item>
            <b>ONS Postcode Directory (ONSPD)</b> — postcode centroids used to geocode
            transactions and reference data to grid cells.
          </Item>
        </Section>

        <Section label="Flood risk">
          <Item>
            <b>Environment Agency Flood Risk Register</b> — flood monitoring point locations
            and severity ratings, England only. Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Schools">
          <Item>
            <b>Department for Education — KS4 GCSE results</b> — secondary school performance
            data (Key Stage 4), England. Open Government Licence v3.0.
          </Item>
          <Item>
            <b>Ofsted Management Information</b> — primary school inspection outcomes
            (Outstanding / Good / Requires Improvement / Inadequate), England. Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Crime">
          <Item>
            <b>Police UK open crime data</b> — crime counts aggregated to LSOA level,
            England &amp; Wales. Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Demographics &amp; commute">
          <Item>
            <b>ONS Census 2021</b> — community age profiles and commute distance distributions,
            Great Britain. Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Transport">
          <Item>
            <b>Office of Rail and Road / National Rail</b> — rail station locations,
            Great Britain.
          </Item>
          <Item>
            <b>NaPTAN (National Public Transport Access Nodes)</b> — bus stops, coach bays,
            tram and metro station entrances, Great Britain. Department for Transport.
            Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Broadband">
          <Item>
            <b>Ofcom Connected Nations Update</b> — fixed broadband coverage by Output Area,
            Great Britain. Includes average speed estimates and percentage of premises with
            ultrafast (≥300 Mbit/s) coverage. Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Energy performance">
          <Item>
            <b>Energy Performance of Buildings Register — Domestic EPC data</b> — energy
            efficiency ratings and fuel type for residential properties, England &amp; Wales.
            Department for Levelling Up, Housing and Communities. Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Health">
          <Item>
            <b>NHS Organisation Data Service (ODS) — GP Practice file (epraccur)</b> — all
            active GP surgeries in England with postcode, geocoded via postcodes.io.
            Open Government Licence v3.0.
          </Item>
          <Item>
            <b>NHS BSA Consolidated Pharmaceutical List</b> — community pharmacy locations in
            England, geocoded via postcodes.io. Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Local amenities (OpenStreetMap)">
          <Item>
            <b>OpenStreetMap contributors via Overpass API</b> — pub and bar locations
            (<code>amenity=pub / bar</code>), supermarket and convenience store locations
            (<code>shop=supermarket / convenience</code>). Licence: ODbL
            (Open Database Licence).
          </Item>
        </Section>

        <Section label="Planning &amp; heritage">
          <Item>
            <b>MHCLG Planning Data — Listed Buildings</b> — Grade I, II* and II listed
            building locations for England. Open Government Licence v3.0.
          </Item>
          <Item>
            <b>MHCLG Planning Data — Planning Applications</b> — planning application
            locations for councils that submit data in the standardised format (~half of
            English LPAs as of 2025). Open Government Licence v3.0.
          </Item>
        </Section>

        <Section label="Short-term lets">
          <Item>
            <b>Inside Airbnb</b> — short-term rental listing locations for major UK cities
            (London, Greater Manchester, Edinburgh, Bristol). "Entire home" listings only.
            Licence: Creative Commons Attribution 4.0 International (CC BY 4.0).
            Data sourced from Inside Airbnb (insideairbnb.com).
          </Item>
        </Section>

        <Section label="Elections">
          <Item>
            <b>Electoral Commission — General Election 2024 results</b> — constituency-level
            vote shares, Great Britain. Open Government Licence v3.0.
          </Item>
        </Section>

        <div style={{ marginTop: 12, opacity: 0.72, fontSize: 13 }}>
          All datasets are used under their respective open licences. Geocoding of NHS
          postcode data uses the free postcodes.io API. Map tiles © OpenStreetMap contributors.
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", opacity: 0.55, marginBottom: 6 }}>
        {label}
      </div>
      <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 14, opacity: 0.92 }}>
        {children}
      </ul>
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <li style={{ marginBottom: 7 }}>{children}</li>;
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
