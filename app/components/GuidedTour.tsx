"use client";

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";

/* ─────────────────────────────────────────────
   Tour step definition
   ───────────────────────────────────────────── */

export type TourStep = {
  /** CSS selector for the element to spotlight (null = centred card with no spotlight) */
  target: string | null;
  /** Tooltip / card body text (supports JSX via render) */
  text: string;
  /** Bold header line */
  title?: string;
  /** Where the tooltip sits relative to the target */
  placement?: "top" | "bottom" | "left" | "right" | "center";
  /**
   * If set, the step will NOT auto-advance on "Next".
   * Instead the tour waits until the described condition is met.
   * `waitFor` is a CSS selector — the step advances once that element exists in DOM.
   */
  waitFor?: string;
  /** Callback fired when this step becomes active (e.g. open a panel) */
  onEnter?: () => void;
  /** Callback fired when leaving this step */
  onLeave?: () => void;
  /** If true the step has no Next button — it only advances via waitFor */
  autoAdvanceOnly?: boolean;
  /** Extra ms to delay before showing the step (lets panels animate in) */
  enterDelay?: number;
};

type GuidedTourProps = {
  steps: TourStep[];
  active: boolean;
  onEnd: () => void;
  /** Current step index (managed externally so parent can react) */
  stepIndex: number;
  onStepChange: (idx: number) => void;
};

/* ─────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────── */

const EDGE_MARGIN = 8; // minimum px from any viewport edge
const GAP = 14;        // gap between spotlight and tooltip
const SPOTLIGHT_PAD = 8;

type Placement = "top" | "bottom" | "left" | "right";

/** Calculate available space on each side of the spotlight rect */
function spaceAround(r: DOMRect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    top: r.top - SPOTLIGHT_PAD,
    bottom: vh - r.bottom - SPOTLIGHT_PAD,
    left: r.left - SPOTLIGHT_PAD,
    right: vw - r.right - SPOTLIGHT_PAD,
  };
}

/** Pick the best placement that fits the tooltip without covering the target */
function autoPick(r: DOMRect, tw: number, th: number, hint?: Placement | "center"): Placement {
  const s = spaceAround(r);
  // If the hint fits, use it
  if (hint && hint !== "center") {
    if (hint === "bottom" && s.bottom >= th + GAP) return "bottom";
    if (hint === "top" && s.top >= th + GAP) return "top";
    if (hint === "right" && s.right >= tw + GAP) return "right";
    if (hint === "left" && s.left >= tw + GAP) return "left";
  }
  // Otherwise pick the side with the most space, preferring bottom > top > right > left
  type Entry = [Placement, number];
  const candidates: Entry[] = [
    ["bottom", s.bottom],
    ["top", s.top],
    ["right", s.right],
    ["left", s.left],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][0];
}

/** Clamp a value so the tooltip stays fully on-screen */
function clampPos(pos: number, size: number, maxSize: number): number {
  return Math.max(EDGE_MARGIN, Math.min(pos, maxSize - size - EDGE_MARGIN));
}

/* ─────────────────────────────────────────────
   Component
   ───────────────────────────────────────────── */

export default function GuidedTour({ steps, active, onEnd, stepIndex, onStepChange }: GuidedTourProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<React.CSSProperties>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(stepIndex);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  stepRef.current = stepIndex;

  const step = steps[stepIndex] as TourStep | undefined;

  /* ── Measure target element ── */
  const measure = useCallback(() => {
    if (!step?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (el) {
      setRect(el.getBoundingClientRect());
    } else {
      setRect(null);
    }
  }, [step]);

  /* ── On step change: fire onEnter, start measuring ── */
  useEffect(() => {
    if (!active || !step) return;

    setVisible(false);
    const delay = step.enterDelay ?? 200;

    const t = setTimeout(() => {
      step.onEnter?.();
      // small extra delay so the DOM has time to render the panel
      setTimeout(() => {
        measure();
        setVisible(true);
      }, 150);
    }, delay);

    // Keep measuring so the spotlight follows layout shifts
    const iv = setInterval(measure, 350);
    pollRef.current = iv;

    return () => {
      clearTimeout(t);
      clearInterval(iv);
      pollRef.current = null;
    };
  }, [active, stepIndex, step, measure]);

  /* ── waitFor polling — auto-advance when element appears ── */
  useEffect(() => {
    if (!active || !step?.waitFor) return;
    const sel = step.waitFor;
    const iv = setInterval(() => {
      const el = document.querySelector(sel);
      if (el) {
        clearInterval(iv);
        goNext();
      }
    }, 250);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, step]);

  /* ── Recompute tooltip position after render so we know its real size ── */
  useLayoutEffect(() => {
    if (!visible) return;
    const el = tooltipRef.current;
    if (!el) return;

    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const hintPlacement = step?.placement ?? (rect ? "bottom" : "center");

    if (!rect || hintPlacement === "center") {
      setTooltipPos({
        position: "fixed",
        top: Math.max(EDGE_MARGIN, (vh - th) / 2),
        left: Math.max(EDGE_MARGIN, (vw - tw) / 2),
      });
      return;
    }

    const picked = autoPick(rect, tw, th, hintPlacement);
    let top = 0;
    let left = 0;

    switch (picked) {
      case "bottom": {
        top = rect.bottom + SPOTLIGHT_PAD + GAP;
        left = rect.left + rect.width / 2 - tw / 2;
        break;
      }
      case "top": {
        top = rect.top - SPOTLIGHT_PAD - GAP - th;
        left = rect.left + rect.width / 2 - tw / 2;
        break;
      }
      case "right": {
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.right + SPOTLIGHT_PAD + GAP;
        break;
      }
      case "left": {
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.left - SPOTLIGHT_PAD - GAP - tw;
        break;
      }
    }

    // Clamp to viewport
    top = clampPos(top, th, vh);
    left = clampPos(left, tw, vw);

    setTooltipPos({ position: "fixed", top, left });
  }, [visible, rect, step]);

  const goNext = useCallback(() => {
    const cur = stepRef.current;
    const s = steps[cur];
    s?.onLeave?.();
    if (cur + 1 >= steps.length) {
      onEnd();
    } else {
      onStepChange(cur + 1);
    }
  }, [steps, onEnd, onStepChange]);

  const goPrev = useCallback(() => {
    const cur = stepRef.current;
    if (cur <= 0) return;
    const s = steps[cur];
    s?.onLeave?.();
    onStepChange(cur - 1);
  }, [steps, onStepChange]);

  if (!active || !step || !visible) return null;

  const hasSpotlight = !!rect;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
      {/* Dark overlay with cutout */}
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
                x={rect.left - SPOTLIGHT_PAD}
                y={rect.top - SPOTLIGHT_PAD}
                width={rect.width + SPOTLIGHT_PAD * 2}
                height={rect.height + SPOTLIGHT_PAD * 2}
                rx={10}
                ry={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.62)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Spotlight ring glow */}
      {hasSpotlight && (
        <div
          style={{
            position: "fixed",
            left: rect.left - SPOTLIGHT_PAD,
            top: rect.top - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            borderRadius: 10,
            border: "2px solid rgba(250,204,21,0.85)",
            boxShadow: "0 0 0 4px rgba(250,204,21,0.25), inset 0 0 0 1px rgba(250,204,21,0.12)",
            pointerEvents: "none",
            animation: "tourSpotlightPulse 1.8s ease-in-out infinite",
          }}
        />
      )}

      {/* Click shield — blocks interactions except on the spotlight area */}
      <div
        style={{ position: "fixed", inset: 0 }}
        onClick={(e) => {
          if (hasSpotlight) {
            const mx = (e as React.MouseEvent).clientX;
            const my = (e as React.MouseEvent).clientY;
            if (
              mx >= rect.left - SPOTLIGHT_PAD &&
              mx <= rect.right + SPOTLIGHT_PAD &&
              my >= rect.top - SPOTLIGHT_PAD &&
              my <= rect.bottom + SPOTLIGHT_PAD
            ) {
              return;
            }
          }
          e.stopPropagation();
          e.preventDefault();
        }}
      />

      {/* Allow pointer events inside spotlight */}
      {hasSpotlight && (
        <div
          style={{
            position: "fixed",
            left: rect.left - SPOTLIGHT_PAD,
            top: rect.top - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            pointerEvents: "auto",
            zIndex: 10001,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        style={{
          ...tooltipPos,
          zIndex: 10002,
          width: "min(290px, calc(100vw - 16px))",
          maxWidth: "calc(100vw - 16px)",
          padding: "14px 16px",
          borderRadius: 14,
          background: "rgba(10,12,20,0.97)",
          border: "1px solid rgba(250,204,21,0.45)",
          backdropFilter: "blur(14px)",
          color: "white",
          boxShadow: "0 10px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(250,204,21,0.15)",
          fontSize: 12,
          lineHeight: 1.5,
          pointerEvents: "auto",
          animation: "tourCardFadeIn 220ms ease-out",
        }}
      >
        {/* Step counter */}
        <div style={{ fontSize: 9, opacity: 0.45, marginBottom: 6 }}>
          Step {stepIndex + 1} of {steps.length}
        </div>

        {step.title && (
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{step.title}</div>
        )}

        <div style={{ opacity: 0.92 }}>{step.text}</div>

        {/* Navigation */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          {stepIndex > 0 && (
            <TourBtn onClick={goPrev} label="← Back" />
          )}
          {!step.autoAdvanceOnly && (
            <TourBtn
              onClick={goNext}
              label={stepIndex + 1 >= steps.length ? "Finish" : "Next →"}
              primary
            />
          )}
          {step.autoAdvanceOnly && (
            <div style={{ flex: 1, fontSize: 10, opacity: 0.55, fontStyle: "italic" }}>
              Waiting for you to do this…
            </div>
          )}
          <button
            type="button"
            onClick={onEnd}
            style={{
              marginLeft: "auto",
              cursor: "pointer",
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.35)",
              fontSize: 10,
              textDecoration: "underline",
              textUnderlineOffset: 3,
              padding: "4px 2px",
            }}
          >
            End tour
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Tiny pill button for tour nav ── */
function TourBtn({ onClick, label, primary }: { onClick: () => void; label: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: "pointer",
        border: primary
          ? "1px solid rgba(250,204,21,0.65)"
          : "1px solid rgba(255,255,255,0.2)",
        background: primary
          ? "rgba(250,204,21,0.22)"
          : "rgba(255,255,255,0.08)",
        color: "white",
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: primary ? 700 : 500,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
