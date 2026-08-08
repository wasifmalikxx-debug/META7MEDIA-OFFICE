"use client";

import * as React from "react";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Sign-in animation primitives (21st.dev "Modern Animated Sign In", adapted).
 *
 * Four changes from the source, each deliberate:
 *
 * 1. `motion/react` → `framer-motion`. That package name is the v12+ alias;
 *    this app is on framer-motion ^13 and does not have `motion` installed.
 * 2. The orbit no longer carries devicon logos from a jsDelivr CDN. Those were
 *    HTML5/React/Figma/Git — the wrong story for a staff portal, and nine
 *    external image requests on the one page that must work when the network
 *    is poor. The caller passes local nodes instead; the login passes lucide
 *    icons, which are already bundled.
 * 3. Colours come from our tokens, so the page follows the light/dark toggle
 *    instead of being dark-only.
 * 4. Every animation here is disabled under `prefers-reduced-motion` (the CSS
 *    side lives in globals.css; the JS side is the `reduced` checks below).
 *
 * The form itself is NOT here. The source shipped an `AnimatedForm` that owned
 * its own fields, validation and submit — this app's login has to drive
 * FingerprintJS, next-auth and the device-approval handshake, so the page
 * composes these primitives around its own form instead.
 */

/** Company blue, off the logo mark. The only colour in here that isn't a token. */
export const BRAND = "#0546ac";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ─── GlowInput ───────────────────────────────────────────────────────
 * An input whose border lights up under the cursor. The glow is painted on a
 * wrapper and the input sits inset by 1px, so the effect reads as the border
 * itself rather than a halo around the field.
 */

export const GlowInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function GlowInput({ className, type, ...props }, ref) {
  const RADIUS = 110;
  const [visible, setVisible] = React.useState(false);
  const reduced = usePrefersReducedMotion();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const background = useMotionTemplate`radial-gradient(${
    visible ? RADIUS + "px" : "0px"
  } circle at ${mouseX}px ${mouseY}px, ${BRAND}, transparent 80%)`;

  return (
    <motion.div
      style={reduced ? undefined : { background }}
      onMouseMove={(e) => {
        const { left, top } = e.currentTarget.getBoundingClientRect();
        mouseX.set(e.clientX - left);
        mouseY.set(e.clientY - top);
      }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      className="group/input rounded-lg p-px transition duration-300"
    >
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-11 w-full rounded-[7px] border border-input bg-card px-3 py-2 text-sm text-foreground",
          "transition-colors placeholder:text-muted-foreground/70",
          "focus-visible:border-transparent focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </motion.div>
  );
});

/* ─── BoxReveal ───────────────────────────────────────────────────────
 * A coloured panel wipes off to the right, revealing the content underneath.
 */

export const BoxReveal = React.memo(function BoxReveal({
  children,
  width = "fit-content",
  boxColor = BRAND,
  duration = 0.4,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  width?: string;
  boxColor?: string;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  return (
    <div style={{ width, position: "relative", overflow: "hidden" }} className={className}>
      {/* Deliberately CSS, not framer.
       *
       * This is the first paint of the first screen anybody sees, and framer
       * drives on requestAnimationFrame — which the browser throttles to
       * almost nothing whenever the document is not visible (a background
       * tab, a restored session, an embedded webview). A JS-driven wipe that
       * stalls leaves a solid blue bar sitting over the email and password
       * fields, which is a locked-out user, not a cosmetic glitch. A CSS
       * animation keeps its own clock and cannot strand the form.
       *
       * The source also gated this behind `useInView`, which has the same
       * failure mode: no IntersectionObserver callback, no reveal, ever.
       * Viewport gating earns nothing on a login form that is on screen the
       * moment it mounts.
       *
       * `animation-fill-mode: both` is what holds the end state, and
       * prefers-reduced-motion is handled in globals.css alongside the
       * keyframes — so there is no JS media query to get out of sync.
       */}
      <div
        className="reveal-content"
        style={{ animationDuration: `${duration}s`, animationDelay: `${delay + 0.2}s` }}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="reveal-wipe"
        style={{
          animationDuration: `${duration}s`,
          animationDelay: `${delay}s`,
          background: boxColor,
        }}
      />
    </div>
  );
});

/* ─── Ripple ──────────────────────────────────────────────────────────
 * Concentric rings breathing out from the centre of the brand panel.
 */

export const Ripple = React.memo(function Ripple({
  mainCircleSize = 180,
  mainCircleOpacity = 0.22,
  numCircles = 9,
  className,
}: {
  mainCircleSize?: number;
  mainCircleOpacity?: number;
  numCircles?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center",
        "[mask-image:radial-gradient(circle_at_center,black_35%,transparent_75%)]",
        className,
      )}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const size = mainCircleSize + i * 84;
        return (
          <span
            key={i}
            className="animate-ripple absolute rounded-full border border-foreground/10"
            style={{
              width: size,
              height: size,
              opacity: Math.max(mainCircleOpacity - i * 0.022, 0),
              animationDelay: `${i * 0.08}s`,
              borderStyle: i === numCircles - 1 ? "dashed" : "solid",
              top: "50%",
              left: "50%",
            }}
          />
        );
      })}
    </div>
  );
});

/* ─── OrbitingCircles ─────────────────────────────────────────────────── */

export const OrbitingCircles = React.memo(function OrbitingCircles({
  className,
  children,
  reverse = false,
  duration = 20,
  delay = 10,
  radius = 120,
}: {
  className?: string;
  children: React.ReactNode;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  radius?: number;
}) {
  return (
    <div
      style={
        {
          "--duration": duration,
          "--radius": radius,
          "--delay": -delay,
        } as React.CSSProperties
      }
      className={cn(
        "animate-orbit absolute flex size-full transform-gpu items-center justify-center rounded-full",
        "[animation-delay:calc(var(--delay)*1000ms)]",
        reverse && "[animation-direction:reverse]",
        className,
      )}
    >
      {children}
    </div>
  );
});

/* ─── BrandOrbit ──────────────────────────────────────────────────────
 * The left panel: brand lockup in the middle, icons orbiting around it.
 */

export type OrbitItem = {
  node: React.ReactNode;
  radius: number;
  duration?: number;
  delay?: number;
  reverse?: boolean;
  className?: string;
};

export const BrandOrbit = React.memo(function BrandOrbit({
  items,
  children,
}: {
  items: OrbitItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <Ripple />
      {/* Above the rings, below the orbiting icons. */}
      <div className="relative z-10 flex flex-col items-center text-center">{children}</div>
      {items.map((item, i) => (
        <OrbitingCircles
          key={i}
          radius={item.radius}
          duration={item.duration}
          delay={item.delay}
          reverse={item.reverse}
          className={item.className}
        >
          {item.node}
        </OrbitingCircles>
      ))}
    </div>
  );
});
