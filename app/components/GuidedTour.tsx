"use client";

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";

/* ─────────────────────────────────────────────
   Tour step definition
   ───────────────────────────────────────────── */

export type TourStep = {
  /** CSS selector for the element to spotlight (null = centred card with no spotlight) */
  target: string | null;
  /** Tooltip / card body text */
  text: string;
  /** Bold header line */
  title?: string;
  /** Where the tooltip sits relative to the target */
  placement?: "top" | "bottom" | "left" | "right" | "center" | "top-center";
  /** Auto-advance when this CSS selector appears in the DOM. */
  waitFor?: string;
  /** Callback fired when this step becomes active (e.g. open a panel) */
  onEnter?: () => void;
  /** Callback fired when leaving this step */
  onLeave?: () => void;
  /** If true the step has no Next button — it only advances via waitFor */
  autoAdvanceOnly?: boolean;
  /** Extra ms to delay before showing the step (lets panels animate in) */
  enterDelay?: number;
  /** Section intro — shows "Show me how" + "Skip" instead of "Next" */
  isSectionIntro?: boolean;
  /** Step index to jump to when user clicks "Skip" on a section intro */
  nextSectionIndex?: number;
  /** Hide dark overlay & spotlight ring (for steps showing open dropdowns) */
  noOverlay?: boolean;
};

type GuidedTourProps = {
  steps: TourStep[];
  active: boolean;
  onEnd: () => void;
  stepIndex: number;
  onStepChange: (idx: number) => void;
};

/* ─────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────── */

const EDGE_MARGIN = 8;
const GAP = 14;
const SPOTLIGHT_PAD = 8;

type Placement = "top" | "bottom" | "left" | "right";

function spaceAround(r: DOMRect) {
  return {
    top: r.top - SPOTLIGHT_PAD,
    bottom: window.innerHeight - r.bottom - SPOTLIGHT_PAD,
    left: r.left - SPOTLIGHT_PAD,
    right: window.innerWidth - r.right - SPOTLIGHT_PAD,
  };
}

function autoPick(r: DOMRect, tw: number, th: number, hint?: Placement | "center"): Placement {
  const s = spaceAround(r);
  if (hint && hint !== "center") {
    if (hint === "bottom" && s.bottom >= th + GAP) return "bottom";
    if (hint === "top" && s.top >= th + GAP) return "top";
    if (hint === "right" && s.right >= tw + GAP) return "right";
    if (hint === "left" && s.left >= tw + GAP) return "left";
  }
  type E = [Placement, number];
  const c: E[] = [["bottom", s.bottom], ["top", s.top], ["right", s.right], ["left", s.left]];
  c.sort((a, b) => b[1] - a[1]);
  return c[0][0];
}

function clampPos(pos: number, size: number, max: number): number {
  return Math.max(EDGE_MARGIN, Math.min(pos, max - size - EDGE_MARGIN));
}

/* ─────────────────────────────────────────────
   Component
   ───────────────────────────────────────────── */

export default function GuidedTour({ steps, active, onEnd, stepIndex, onStepChange }: GuidedTourProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<React.CSSProperties>({
    position: "fixed", top: -9999, left: -9999, visibility: "hidden" as const,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(stepIndex);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  stepRef.current = stepIndex;

  const step = steps[stepIndex] as TourStep | undefined;

  /* ── Measure target element ── */
  const measure = useCallback(() => {
    if (!step?.target) { setRect(null); return; }
    const el = document.querySelector(step.target);
    if (el) setRect(el.getBoundingClientRect());
    else setRect(null);
  }, [step]);

  /* ── On step change: fire onEnter, start measuring ── */
  useEffect(() => {
    if (!active || !step) return;

    setVisible(false);
    setTooltipPos({ position: "fixed", top: -9999, left: -9999, visibility: "hidden" as const });
    const delay = step.enterDelay ?? 200;

    const t = setTimeout(() => {
      step.onEnter?.();
      setTimeout(() => { measure(); setVisible(true); }, 180);
    }, delay);

    const iv = setInterval(measure, 350);
    pollRef.current = iv;

    return () => { clearTimeout(t); clearInterval(iv); pollRef.current = null; };
  }, [active, stepIndex, step, measure]);

  /* ── waitFor polling ── */
  useEffect(() => {
    if (!active || !step?.waitFor) return;
    const sel = step.waitFor;
    const iv = setInterval(() => {
      if (document.querySelector(sel)) { clearInterval(iv); goNext(); }
    }, 300);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, step]);

  /* ── Position tooltip after render ── */
  useLayoutEffect(() => {
    if (!visible) return;
    const el = tooltipRef.current;
    if (!el) return;

    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const hint = step?.placement ?? (rect ? "bottom" : "center");

    if (!rect || hint === "center" || hint === "top-center") {
      const topPos = hint === "top-center" ? EDGE_MARGIN + 60 : Math.max(EDGE_MARGIN, (vh - th) / 2);
      setTooltipPos({
        position: "fixed",
        top: topPos,
        left: Math.max(EDGE_MARGIN, (vw - tw) / 2),
        visibility: "visible" as const,
      });
      return;
    }

    const picked = autoPick(rect, tw, th, hint);
    let top = 0, left = 0;

    switch (picked) {
      case "bottom": top = rect.bottom + SPOTLIGHT_PAD + GAP; left = rect.left + rect.width / 2 - tw / 2; break;
      case "top":    top = rect.top - SPOTLIGHT_PAD - GAP - th; left = rect.left + rect.width / 2 - tw / 2; break;
      case "right":  top = rect.top + rect.height / 2 - th / 2; left = rect.right + SPOTLIGHT_PAD + GAP; break;
      case "left":   top = rect.top + rect.height / 2 - th / 2; left = rect.left - SPOTLIGHT_PAD - GAP - tw; break;
    }

    top = clampPos(top, th, vh);
    left = clampPos(left, tw, vw);
    setTooltipPos({ position: "fixed", top, left, visibility: "visible" as const });
  }, [visible, rect, step]);

  /* ── Navigation ── */
  const goNext = useCallback(() => {
    const s = steps[stepRef.current];
    s?.onLeave?.();
    if (stepRef.current + 1 >= steps.length) onEnd();
    else onStepChange(stepRef.current + 1);
  }, [steps, onEnd, onStepChange]);

  const goPrev = useCallback(() => {
    if (stepRef.current <= 0) return;
    steps[stepRef.current]?.onLeave?.();
    const prevIdx = stepRef.current - 1;
    onStepChange(prevIdx);
    // Re-fire previous step's onEnter so its state is restored
    setTimeout(() => steps[prevIdx]?.onEnter?.(), 80);
  }, [steps, onStepChange]);

  const goTo = useCallback((idx: number) => {
    steps[stepRef.current]?.onLeave?.();
    if (idx >= steps.length) onEnd();
    else onStepChange(idx);
  }, [steps, onEnd, onStepChange]);

  if (!active || !step || !visible) return null;

  const hasSpotlight = !!rect;
  const showOverlay = !step.noOverlay;
  const isLast = stepIndex + 1 >= steps.length;

  /* Progress label — show section X of Y for intros, step N of total otherwise */
  const sectionIntros = steps.filter(s => s.isSectionIntro);
  const currentSectionIdx = step.isSectionIntro
    ? sectionIntros.indexOf(step)
    : (() => { for (let i = stepIndex; i >= 0; i--) { if (steps[i].isSectionIntro) return sectionIntros.indexOf(steps[i]); } return -1; })();
  const progressLabel = step.isSectionIntro
    ? `Section ${currentSectionIdx + 1} of ${sectionIntros.length}`
    : currentSectionIdx >= 0
      ? `${sectionIntros[currentSectionIdx]?.title ?? ""}`
      : `Step ${stepIndex + 1} of ${steps.length}`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }}>

      {/* ── Dark overlay with cutout ── */}
      {showOverlay && (
        <>
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
            preserveAspectRatio="none"
          >
            <defs>
              <mask id="tour-mask">
                <rect width="100%" height="100%" fill="white" />
                {hasSpotlight && (
                  <rect
                    x={rect.left - SPOTLIGHT_PAD} y={rect.top - SPOTLIGHT_PAD}
                    width={rect.width + SPOTLIGHT_PAD * 2} height={rect.height + SPOTLIGHT_PAD * 2}
                    rx={10} ry={10} fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.38)" mask="url(#tour-mask)" />
          </svg>

          {hasSpotlight && (
            <div style={{
              position: "fixed",
              left: rect.left - SPOTLIGHT_PAD, top: rect.top - SPOTLIGHT_PAD,
              width: rect.width + SPOTLIGHT_PAD * 2, height: rect.height + SPOTLIGHT_PAD * 2,
              borderRadius: 10,
              border: "2px solid rgba(250,204,21,0.85)",
              boxShadow: "0 0 0 4px rgba(250,204,21,0.25), inset 0 0 0 1px rgba(250,204,21,0.12)",
              pointerEvents: "none",
              animation: "tourSpotlightPulse 1.8s ease-in-out infinite",
            }} />
          )}

          {/* ── Animated cursor indicator — shows a pointer + click ripple on the target ── */}
          {hasSpotlight && !step.isSectionIntro && !step.autoAdvanceOnly && (
            <div
              style={{
                position: "fixed",
                left: rect.left + rect.width * 0.55,
                top: rect.top + rect.height * 0.55,
                width: 32,
                height: 32,
                pointerEvents: "none",
                zIndex: 10003,
                animation: "tourCursorBob 2s ease-in-out infinite",
              }}
            >
              {/* Cursor arrow SVG */}
              <svg viewBox="0 0 24 24" width="28" height="28" style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.6))" }}>
                <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z" fill="white" stroke="rgba(250,204,21,0.9)" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              {/* Click ripple */}
              <div style={{
                position: "absolute",
                top: -2,
                left: -2,
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: "2px solid rgba(250,204,21,0.55)",
                animation: "tourClickRipple 2.2s ease-out infinite",
                animationDelay: "0.6s",
              }} />
            </div>
          )}

          {/* Click shield */}
          <div
            style={{ position: "fixed", inset: 0, pointerEvents: "auto" }}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
          />
        </>
      )}

      {/* ── Tooltip card ── */}
      <div
        ref={tooltipRef}
        style={{
          ...tooltipPos,
          zIndex: 10002,
          width: "min(310px, calc(100vw - 16px))",
          maxWidth: "calc(100vw - 16px)",
          padding: "16px 18px",
          borderRadius: 14,
          background: "rgba(10,12,20,0.92)",
          border: step.isSectionIntro
            ? "2px solid rgba(250,204,21,0.65)"
            : "1px solid rgba(250,204,21,0.45)",
          backdropFilter: "blur(14px)",
          color: "white",
          boxShadow: "0 10px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(250,204,21,0.15)",
          fontSize: 13,
          lineHeight: 1.55,
          pointerEvents: "auto",
          animation: "tourCardFadeIn 220ms ease-out",
        }}
      >
        <div style={{ fontSize: 10, opacity: 0.45, marginBottom: 6 }}>
          {progressLabel}
        </div>

        {step.title && (
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, lineHeight: 1.3 }}>
            {step.title}
          </div>
        )}

        <div style={{ opacity: 0.92, fontSize: 13, lineHeight: 1.6 }}>{step.text}</div>

        {/* ── Navigation ── */}
        <div style={{ display: "flex", gap: 6, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>

          {/* Section intro: "Show me" + "Skip" */}
          {step.isSectionIntro && (
            <>
              <TourBtn onClick={goNext} label="✨ Show me" primary />
              {step.nextSectionIndex != null && (
                <TourBtn onClick={() => goTo(step.nextSectionIndex!)} label="Skip →" />
              )}
            </>
          )}

          {/* Regular / demo step: Back + Next */}
          {!step.isSectionIntro && !step.autoAdvanceOnly && (
            <>
              {stepIndex > 0 && <TourBtn onClick={goPrev} label="← Back" />}
              <TourBtn onClick={goNext} label={isLast ? "Finish ✓" : "Next →"} primary />
            </>
          )}

          {step.autoAdvanceOnly && (
            <div style={{ flex: 1, fontSize: 11, opacity: 0.55, fontStyle: "italic" }}>
              Just a moment…
            </div>
          )}

          <button
            type="button"
            onClick={onEnd}
            style={{
              marginLeft: "auto", cursor: "pointer", border: "none",
              background: "transparent", color: "rgba(255,255,255,0.35)",
              fontSize: 10, textDecoration: "underline", textUnderlineOffset: 3, padding: "4px 2px",
            }}
          >
            End tour
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Pill button ── */
function TourBtn({ onClick, label, primary }: { onClick: () => void; label: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: "pointer",
        border: primary ? "1px solid rgba(250,204,21,0.65)" : "1px solid rgba(255,255,255,0.2)",
        background: primary ? "rgba(250,204,21,0.22)" : "rgba(255,255,255,0.08)",
        color: "white",
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: primary ? 700 : 500,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
