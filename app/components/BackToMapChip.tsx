"use client";

import { useEffect, useState } from "react";

const fallbackHref = "/?from=docs";

export default function BackToMapChip() {
  const [href, setHref] = useState(fallbackHref);
  const [inIframe, setInIframe] = useState(false);

  useEffect(() => {
    // Check if we're running inside the doc modal iframe
    const embedded = typeof window !== "undefined" &&
      (window !== window.top || new URLSearchParams(window.location.search).get("embedded") === "1");
    setInIframe(embedded);

    if (!embedded) {
      try {
        const stored = sessionStorage.getItem("valuemap:return-url");
        if (stored && stored.startsWith("/")) {
          const url = new URL(stored, window.location.origin);
          url.searchParams.set("from", "docs");
          setHref(`${url.pathname}${url.search}`);
        }
      } catch {
        // ignore storage errors
      }
    }
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    if (inIframe) {
      e.preventDefault();
      try { window.parent.postMessage("close-doc-modal", "*"); } catch { /* ignore */ }
    }
  };

  return (
    <a
      href={inIframe ? "#" : href}
      onClick={handleClick}
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
        cursor: "pointer",
      }}
    >
      ← Back to map
    </a>
  );
}
