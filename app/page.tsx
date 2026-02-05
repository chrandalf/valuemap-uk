import Map from "./Map";

export default function Home() {
  return (
    <main style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <Map />

      {/* Top-left “product” panel */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          width: 420,
          maxWidth: "calc(100vw - 36px)",
          padding: 16,
          borderRadius: 16,
          background: "rgba(10, 12, 20, 0.72)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(10px)",
          color: "white",
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: 0.6, opacity: 0.8 }}>VALUEMAP UK</div>
        <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>UK House Price Grid</div>
        <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.35 }}>
          Grid-based medians and deltas (trailing 12 months). Filters + data layer next.
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <Pill label="Grid: 5km" />
          <Pill label="Metric: Median" />
          <Pill label="Type: All" />
          <Pill label="New build: All" />
        </div>
      </div>

      {/* Bottom-right mini legend */}
      <div
        style={{
          position: "absolute",
          right: 18,
          bottom: 18,
          padding: "10px 12px",
          borderRadius: 14,
          background: "rgba(10, 12, 20, 0.72)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(10px)",
          color: "white",
          fontSize: 12,
          opacity: 0.9,
        }}
      >
        Map running ✅ — data layer next
      </div>
    </main>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
      }}
    >
      {label}
    </span>
  );
}