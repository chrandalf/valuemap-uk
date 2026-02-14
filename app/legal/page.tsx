export default function LegalPage() {
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
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Legal & Data Notice</h1>
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>
          This application is provided for general information only. It is not legal, financial,
          insurance, valuation, surveying, mortgage, or investment advice. You should not rely on
          this app as the sole basis for any property decision.
        </p>

        <Section title="1) Information-only service">
          The maps, overlays, scores, and summaries are indicative and may be incomplete, delayed,
          or inaccurate. Outputs are provided “as is” and may change without notice.
        </Section>

        <Section title="2) Flood data limitations">
          Flood information in this app is presented for contextual awareness only. It does not
          replace official flood searches, environmental reports, insurer checks, lender
          requirements, or professional advice. Where a nearest-risk postcode is shown, this does
          not mean the searched postcode has that same risk.
        </Section>

        <Section title="3) Property value metrics limitations">
          Price metrics are aggregated and can be influenced by sample size, property mix, and
          transaction timing. They should not be treated as a formal valuation.
        </Section>

        <Section title="4) Coverage and timeliness">
          Coverage can vary by region and period. Some areas (including parts of Scotland) may be
          partial or less current. Always verify with official and up-to-date sources.
        </Section>

        <Section title="5) No warranties">
          To the fullest extent permitted by law, we make no warranties (express or implied)
          regarding accuracy, completeness, fitness for purpose, availability, or non-infringement.
        </Section>

        <Section title="6) Limitation of liability">
          To the fullest extent permitted by law, we are not liable for any loss or damage
          (including direct, indirect, consequential, or financial loss) arising from use of, or
          reliance on, this app.
        </Section>

        <Section title="7) Third-party data and links">
          This app uses third-party data and may link to third-party services. Their terms,
          licences, and privacy policies apply separately.
        </Section>

        <Section title="8) User responsibility">
          You are responsible for independently verifying all material facts before making any
          property, insurance, or financial decision.
        </Section>

        <Section title="9) Privacy (location)">
          If you use location features, your device will request permission. Location is used to
          provide map context. See the Privacy Notice for details on processing and retention.
        </Section>

        <Section title="10) Contact">
          For legal/privacy/data enquiries:{" "}
          <a href="mailto:chris.randallse@gmail.com" style={{ color: "#93c5fd" }}>
            chris.randallse@gmail.com
          </a>
          .
        </Section>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <NavChip href="/">Back to map</NavChip>
          <NavChip href="/privacy">Privacy</NavChip>
          <NavChip href="/contact">Contact</NavChip>
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
