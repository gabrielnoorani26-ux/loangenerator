import { cn } from "@/lib/utils";

/** Bottom action bar that sticks to the viewport bottom within the page column. */
export function StickyBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 border-t bg-card/95 px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}
