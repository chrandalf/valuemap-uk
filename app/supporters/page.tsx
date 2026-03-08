"use client";

import { useEffect, useRef, useState } from "react";
import BackToMapChip from "../components/BackToMapChip";

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  freq: number;
}

export default function SupportersPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [supporters, setSupporters] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/supporters?limit=50")
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: string[] };
        if (Array.isArray(data.items)) setSupporters(data.items);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Starfield canvas animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId: number;
    let stars: Star[] = [];

    function resize() {
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      stars = Array.from({ length: 220 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: 0.25 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        freq: 0.2 + Math.random() * 1.0,
      }));
    }

    resize();
    window.addEventListener("resize", resize);

    function draw(t: number) {
      if (!canvas || !ctx) return;
      ctx.fillStyle = "#000008";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const secs = t / 1000;
      for (const s of stars) {
        const v = Math.sin(secs * s.freq + s.phase) * 0.5 + 0.5;
        const opacity = 0.15 + 0.85 * v * v;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${opacity.toFixed(3)})`;
        ctx.fill();
      }
      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000008",
        overflow: "hidden",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <style>{`
        @keyframes vm-crawl {
          from { transform: rotateX(22deg) translateY(105vh); }
          to   { transform: rotateX(22deg) translateY(-460%); }
        }
        @keyframes vm-title-glow {
          0%, 100% { text-shadow: 0 0 12px rgba(245,230,66,0.5); }
          50%       { text-shadow: 0 0 28px rgba(245,230,66,0.9), 0 0 60px rgba(245,200,0,0.4); }
        }
      `}</style>

      {/* Starfield */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {/* Opening crawl */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          perspective: "500px",
          overflow: "hidden",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 4%, #000 28%, #000 70%, transparent 94%)",
          maskImage:
            "linear-gradient(to bottom, transparent 4%, #000 28%, #000 70%, transparent 94%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            transformOrigin: "50% 100%",
            animation: "vm-crawl 75s linear 0.6s forwards",
            color: "#f5e642",
            fontSize: "clamp(12px, 2vw, 16px)",
            lineHeight: 1.8,
          }}
        >
          <div style={{ width: "min(540px, 80vw)", margin: "0 auto", textAlign: "center" }}>
          {/* top padding so text crawls in from below */}
          <div style={{ height: "55vh" }} />

          <p
            style={{
              opacity: 0.65,
              fontStyle: "italic",
              fontSize: "0.9em",
              marginBottom: "2em",
            }}
          >
            A long time ago, in a housing market far, far away…
          </p>

          {/* Title block */}
          <div
            style={{
              borderTop: "1px solid rgba(245,230,66,0.35)",
              borderBottom: "1px solid rgba(245,230,66,0.35)",
              padding: "1.2em 0",
              marginBottom: "2em",
            }}
          >
            <div
              style={{
                fontSize: "2em",
                fontWeight: "bold",
                letterSpacing: "0.2em",
                animation: "vm-title-glow 3s ease-in-out infinite",
              }}
            >
              VALUEMAP
            </div>
            <div style={{ fontSize: "0.8em", opacity: 0.6, marginTop: "0.3em" }}>
              Episode I
            </div>
            <div
              style={{
                fontSize: "1em",
                fontStyle: "italic",
                marginTop: "0.25em",
                opacity: 0.85,
              }}
            >
              The Postcode Awakens
            </div>
          </div>

          {/* Supporters — shown early so they're seen quickly */}
          <div
            style={{
              fontSize: "1.1em",
              fontWeight: "bold",
              letterSpacing: "0.2em",
              marginBottom: "0.6em",
            }}
          >
            ⭐&nbsp;SUPPORTERS&nbsp;⭐
          </div>
          <p style={{ opacity: 0.75, fontSize: "0.9em", marginBottom: "1.4em" }}>
            These fine beings bought a coffee to keep the servers running.
            <br />
            The Force is strong with them.
          </p>

          {loaded ? (
            supporters.length > 0 ? (
              <div style={{ margin: "0.5em 0 2em" }}>
                {supporters.map((name, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: "1.35em",
                      fontWeight: "bold",
                      margin: "0.55em 0",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {name}
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  opacity: 0.45,
                  fontStyle: "italic",
                  margin: "0.5em 0 2em",
                }}
              >
                (No names to show yet — be the first!)
              </div>
            )
          ) : (
            <div style={{ opacity: 0.4, fontStyle: "italic", margin: "0.5em 0 2em" }}>
              Loading…
            </div>
          )}

          <p style={{ opacity: 0.6, fontSize: "0.85em" }}>
            Want your name up here?
            <br />
            buymeacoffee.com/valuemap
          </p>

          <div
            style={{
              margin: "3em 0",
              opacity: 0.35,
              letterSpacing: "0.4em",
              fontSize: "0.9em",
            }}
          >
            — ✦ —
          </div>

          {/* Project blurb */}
          <p>
            It is a period of rising prices. Buyers, stretched thin by sky-high
            deposits, have turned to the open web in search of a map that tells
            the truth about where their money will go furthest.
          </p>
          <p>
            Built in the gaps between a day job, ValueMap scans millions of Land
            Registry records to shine light into the chaos of the UK housing
            market.
          </p>
          <p>
            No venture capital. No subscription fees. No adverts.
            <br />
            Just data, a map, and one developer who got tired of guessing.
          </p>

          <div
            style={{
              margin: "3em 0",
              opacity: 0.35,
              letterSpacing: "0.4em",
              fontSize: "0.9em",
            }}
          >
            — ✦ —
          </div>

          {/* Credits */}
          <p style={{ opacity: 0.6, fontSize: "0.85em", lineHeight: 2 }}>
            Built with open data from
            <br />
            HM Land Registry · ONS Census 2021
            <br />
            Environment Agency · data.police.uk
            <br />
            Ofsted · OpenStreetMap
          </p>
          <p style={{ opacity: 0.35, fontSize: "0.75em", marginTop: "1.5em" }}>
            Open Government Licence v3.0
          </p>

          {/* trailing space so names aren't cut off at top */}
          <div style={{ height: "60vh" }} />
          </div>{/* end centering wrapper */}
        </div>
      </div>

      {/* Back to map */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
        }}
      >
        <BackToMapChip />
      </div>
    </div>
  );
}
