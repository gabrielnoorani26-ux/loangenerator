"use client";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Draggable before/after slider. `after` is drawn over `before`, clipped from the left. */
export function BeforeAfter({
  before,
  after,
  className,
  imgStyle,
  beforeLabel = "Before",
  afterLabel = "After",
}: {
  before: string;
  after: string;
  className?: string;
  imgStyle?: React.CSSProperties;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const move = useCallback((clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  }, []);
  return (
    <div
      ref={ref}
      className={cn("checkerboard relative h-full w-full touch-none overflow-hidden select-none", className)}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      data-testid="before-after"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={before}
        alt={beforeLabel}
        draggable={false}
        className="absolute inset-0 size-full object-contain"
        style={imgStyle}
      />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={after}
          alt={afterLabel}
          draggable={false}
          className="absolute inset-0 size-full object-contain"
          style={imgStyle}
        />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${pos}%` }}>
        <div className="absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-primary bg-white text-xs text-primary shadow">
          ⇆
        </div>
      </div>
      <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">{beforeLabel}</span>
      <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">{afterLabel}</span>
    </div>
  );
}
