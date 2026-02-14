export default function PrivacyPage() {
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
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Privacy Notice</h1>
        <p style={{ marginTop: 12, opacity: 0.9, fontSize: 14 }}>
          This page explains what data this app uses and how it is handled.
        </p>

        <Section title="1) Location data">
          If you press “Locate me”, your device asks permission and sends coordinates to your
          browser session for one-shot map context. We do not require continuous tracking.
        </Section>

        <Section title="2) Data storage">
          By default, location use is session-based for map display and is not intended as a
          permanent profile of your movements.
        </Section>

        <Section title="3) Third-party services">
          Some app features call third-party services (for example postcode lookup and map/data
          providers). Their privacy policies and terms apply to those requests.
        </Section>

        <Section title="4) Contact">
          For privacy enquiries, email{" "}
          <a href="mailto:chris.randallse@gmail.com" style={{ color: "#93c5fd" }}>
            chris.randallse@gmail.com
          </a>
          .
        </Section>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <NavChip href="/">Back to map</NavChip>
          <NavChip href="/legal">Legal</NavChip>
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
