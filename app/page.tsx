import Image from "next/image";

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", padding: 32, background: "#0b0f19", color: "white" }}>
      <h1 style={{ fontSize: 42, margin: 0 }}>UK House Price Grid</h1>
      <p style={{ marginTop: 12, opacity: 0.85, fontSize: 18 }}>
        Interactive grid-based medians and deltas (trailing 12 months). Map coming next.
      </p>

      <div
        style={{
          marginTop: 24,
          padding: 16,
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12,
        }}
      >
        <strong>Status:</strong> Live on Cloudflare Pages ✅
      </div>
    </main>
  );
}
