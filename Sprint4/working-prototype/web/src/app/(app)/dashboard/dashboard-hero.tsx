"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

/**
 * The dashboard hero band — the clinic's identity as the centrepiece.
 *
 * A saturated brand-green band (white text in both themes, like the rail) with
 * the clinic brand mark floating over drifting aurora blobs and a sweeping
 * light sheen. The mark also tilts toward the pointer (parallax) on top of its
 * continuous float. All continuous motion is disabled under
 * prefers-reduced-motion via globals.css.
 */
export function DashboardHero({ clinicName }: { clinicName: string }) {
  const bandRef = useRef<HTMLDivElement>(null);
  const parallaxRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);

  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const band = bandRef.current;
    const el = parallaxRef.current;
    if (!band || !el) return;
    const r = band.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5; // -0.5 … 0.5
    const py = (e.clientY - r.top) / r.height - 0.5;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--ry", `${(px * 24).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${(-py * 16).toFixed(2)}deg`);
      el.style.setProperty("--tx", `${(px * 20).toFixed(1)}px`);
      el.style.setProperty("--ty", `${(py * 14).toFixed(1)}px`);
    });
  }, []);

  const handleLeave = useCallback(() => {
    const el = parallaxRef.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--tx", "0px");
    el.style.setProperty("--ty", "0px");
  }, []);

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <div
      ref={bandRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className="ii-rise relative mb-6 overflow-hidden rounded-[26px] shadow-lg"
      style={{
        background:
          "linear-gradient(135deg, var(--green-800) 0%, var(--green-600) 52%, var(--teal-600) 100%)",
      }}
    >
      {/* Aurora blobs — soft drifting brand-colour light. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="ii-aurora-a absolute -left-[8%] top-[-40%] h-[130%] w-[45%] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--mint-500) 85%, transparent), transparent 70%)",
            mixBlendMode: "screen",
            opacity: 0.5,
          }}
        />
        <div
          className="ii-aurora-b absolute right-[-6%] bottom-[-55%] h-[150%] w-[48%] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--teal-400) 90%, transparent), transparent 70%)",
            mixBlendMode: "screen",
            opacity: 0.55,
          }}
        />
        <div
          className="ii-aurora-a absolute left-[38%] top-[10%] h-[90%] w-[36%] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--green-300) 70%, transparent), transparent 70%)",
            mixBlendMode: "soft-light",
            opacity: 0.6,
          }}
        />
      </div>

      {/* Sweeping light sheen. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="ii-sheen absolute inset-y-0 left-0 w-[35%]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.16), transparent)",
          }}
        />
      </div>

      {/* Faint dotted texture for depth. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        aria-hidden
        style={{
          backgroundImage: "radial-gradient(rgb(255 255 255) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* Content */}
      <div className="relative flex flex-col items-start gap-8 p-8 sm:p-10 md:flex-row md:items-center md:justify-between md:gap-6">
        {/* Copy */}
        <div className="max-w-xl">
          <span
            className="ii-rise inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/90 backdrop-blur-sm"
            style={{ ["--d" as string]: "0.12s" }}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            Assistente ativo · responde 24/7
          </span>

          <h1
            className="ii-rise mt-4 text-[40px] font-semibold leading-[0.98] tracking-[-0.035em] text-white sm:text-[52px]"
            style={{ ["--d" as string]: "0.2s" }}
          >
            {clinicName}
          </h1>

          <p
            className="ii-rise mt-2 text-[13px] font-medium uppercase tracking-[0.22em] text-white/60"
            style={{ ["--d" as string]: "0.28s" }}
          >
            Grupo de Saúde
          </p>

          <div
            className="ii-rise mt-6 flex flex-wrap items-center gap-3"
            style={{ ["--d" as string]: "0.36s" }}
          >
            <Link
              href="/agenda"
              className="group inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-[color:var(--green-700)] shadow-sm transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0"
            >
              Ver agenda
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/conversations"
              className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              <Sparkles className="h-4 w-4" />
              Conversas do assistente
            </Link>
          </div>
        </div>

        {/* 3D mark — glow + float + pointer parallax */}
        <div
          className="ii-rise relative mx-auto flex h-[190px] w-[190px] flex-none items-center justify-center sm:h-[230px] sm:w-[230px] md:mx-0"
          style={{ ["--d" as string]: "0.24s" }}
        >
          {/* Glow puck */}
          <div
            className="ii-glow pointer-events-none absolute left-1/2 top-1/2 h-[78%] w-[78%] rounded-full blur-2xl"
            aria-hidden
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--mint-500) 80%, transparent), transparent 68%)",
            }}
          />
          <div className="ii-float relative h-full w-full">
            <div ref={parallaxRef} className="ii-parallax h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/ava-nobg.png"
                alt={`${clinicName} — marca 3D`}
                width={230}
                height={230}
                className="h-full w-full select-none object-contain drop-shadow-[0_24px_40px_rgba(9,40,30,0.45)]"
                draggable={false}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
