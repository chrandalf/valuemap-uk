export default function ContactPage() {
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
          maxWidth: 640,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.16)",
          borderRadius: 14,
          padding: 20,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Contact</h1>
        <p style={{ marginTop: 12, marginBottom: 8, opacity: 0.9, fontSize: 14 }}>
          For questions, feedback, or collaboration, email:
        </p>
        <a
          href="mailto:chris.randallse@gmail.com"
          style={{
            color: "#93c5fd",
            textDecoration: "underline",
            fontSize: 16,
            wordBreak: "break-word",
          }}
        >
          chris.randallse@gmail.com
        </a>
        <div style={{ marginTop: 16 }}>
          <a
            href="/"
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
            Back to map
          </a>
        </div>
      </div>
    </main>
  );
}
