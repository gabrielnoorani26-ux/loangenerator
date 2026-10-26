"use client";
/**
 * Before/after viewer with four modes and synchronized zoom + pan.
 * Wheel zooms around the cursor; drag pans; both panes share one transform.
 */
import { useCallback, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { BeforeAfter } from "./before-after";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CompareMode = "slider" | "side" | "original" | "edited";

interface View {
  scale: number;
  x: number;
  y: number;
}

export function ZoomCompare({ before, after, mode, className }: { before: string; after: string | null; mode: CompareMode; className?: string }) {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const zoomBy = useCallback((factor: number, cx = 0.5, cy = 0.5, rect?: DOMRect) => {
    setView((v) => {
      const scale = Math.min(8, Math.max(1, v.scale * factor));
      if (scale === 1) return { scale: 1, x: 0, y: 0 };
      // Keep the point under the cursor fixed.
      const w = rect?.width ?? 0;
      const h = rect?.height ?? 0;
      const px = (cx - 0.5) * w;
      const py = (cy - 0.5) * h;
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r);
  };
  const panHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (view.scale === 1 || mode === "slider") return;
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      setPanning(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    },
    onPointerUp: () => {
      drag.current = null;
      setPanning(false);
    },
  };
  const style: React.CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: "center",
    transition: panning ? "none" : "transform 60ms",
  };

  const pane = (src: string, label: string) => (
    <div className="checkerboard relative h-full min-h-0 overflow-hidden" onWheel={onWheel} {...panHandlers} style={{ cursor: view.scale > 1 ? "grab" : "zoom-in" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} draggable={false} className="absolute inset-0 size-full object-contain select-none" style={style} />
      <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">{label}</span>
    </div>
  );

  const edited = after ?? before;
  return (
    <div className={cn("relative flex h-full flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        {mode === "side" ? (
          <div className="grid h-full grid-cols-2 gap-px bg-border">
            {pane(before, "Original")}
            {pane(edited, "Edited")}
          </div>
        ) : mode === "original" ? (
          pane(before, "Original")
        ) : mode === "edited" ? (
          pane(edited, "Edited")
        ) : (
          <div className="h-full overflow-hidden" onWheel={onWheel}>
            <BeforeAfter before={before} after={edited} beforeLabel="Original" afterLabel="Edited" imgStyle={style} />
          </div>
        )}
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1 rounded-md bg-white/90 p-1 shadow">
        <Button size="icon-sm" variant="ghost" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
          <Minus />
        </Button>
        <span className="flex w-12 items-center justify-center text-xs tabular-nums">{Math.round(view.scale * 100)}%</span>
        <Button size="icon-sm" variant="ghost" onClick={() => zoomBy(1.4)} aria-label="Zoom in">
          <Plus />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setView({ scale: 1, x: 0, y: 0 })} aria-label="Reset zoom">
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}
