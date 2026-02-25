"use client";

import { useEffect, useState, useCallback, useRef } from "react";

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
   Component
   ───────────────────────────────────────────── */

export default function GuidedTour({ steps, active, onEnd, stepIndex, onStepChange }: GuidedTourProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(stepIndex);
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

  /* ── Tooltip positioning ── */
  const PAD = 14;
  const placement = step.placement ?? (rect ? "bottom" : "center");
  let tooltipStyle: React.CSSProperties;

  if (!rect || placement === "center") {
    tooltipStyle = {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  } else {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    switch (placement) {
      case "bottom":
        tooltipStyle = { position: "fixed", top: rect.bottom + PAD, left: Math.max(12, Math.min(cx, window.innerWidth - 280)) };
        break;
      case "top":
        tooltipStyle = { position: "fixed", bottom: window.innerHeight - rect.top + PAD, left: Math.max(12, Math.min(cx, window.innerWidth - 280)) };
        break;
      case "left":
        tooltipStyle = { position: "fixed", top: cy, right: window.innerWidth - rect.left + PAD };
        break;
      case "right":
        tooltipStyle = { position: "fixed", top: cy, left: rect.right + PAD };
        break;
    }
  }

  /* ── Spotlight cutout (SVG mask) ── */
  const spotlightPad = 8;
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
                x={rect.left - spotlightPad}
                y={rect.top - spotlightPad}
                width={rect.width + spotlightPad * 2}
                height={rect.height + spotlightPad * 2}
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
            left: rect.left - spotlightPad,
            top: rect.top - spotlightPad,
            width: rect.width + spotlightPad * 2,
            height: rect.height + spotlightPad * 2,
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
          // If user clicks inside the spotlight rect, let it through
          if (hasSpotlight) {
            const mx = (e as React.MouseEvent).clientX;
            const my = (e as React.MouseEvent).clientY;
            if (
              mx >= rect.left - spotlightPad &&
              mx <= rect.right + spotlightPad &&
              my >= rect.top - spotlightPad &&
              my <= rect.bottom + spotlightPad
            ) {
              return; // allow click-through
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
            left: rect.left - spotlightPad,
            top: rect.top - spotlightPad,
            width: rect.width + spotlightPad * 2,
            height: rect.height + spotlightPad * 2,
            pointerEvents: "auto",
            zIndex: 10001,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        style={{
          ...tooltipStyle,
          zIndex: 10002,
          width: 290,
          maxWidth: "calc(100vw - 24px)",
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
