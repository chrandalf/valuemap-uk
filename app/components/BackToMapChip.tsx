"use client";

import { useEffect, useState } from "react";

const fallbackHref = "/?from=docs";

export default function BackToMapChip() {
  const [href, setHref] = useState(fallbackHref);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("valuemap:return-url");
      if (stored && stored.startsWith("/")) {
        // Append from=docs so the intro modal (Find My Area) is suppressed on return
        const url = new URL(stored, window.location.origin);
        url.searchParams.set("from", "docs");
        setHref(`${url.pathname}${url.search}`);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

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
      Back to map
    </a>
  );
}
