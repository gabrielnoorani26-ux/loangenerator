"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Aperture, ChevronsLeft, ChevronsRight, LayoutDashboard, Layers, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/presets", label: "Presets", icon: Layers },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  };

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-card transition-[width] md:flex",
          collapsed ? "w-16" : "w-56",
        )}
      >
        <Link href="/" className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
          <Aperture className="size-6 shrink-0 text-primary" />
          {!collapsed && <span>BatchLens</span>}
        </Link>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" || pathname.startsWith("/batches") : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={cn(
                  "flex items-center gap-3 rounded-[6px] px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-gray-100 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={toggle}
          className="m-2 flex cursor-pointer items-center gap-2 rounded-[6px] px-3 py-2 text-xs text-muted-foreground hover:bg-gray-100"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && "Collapse"}
        </button>
      </aside>
      {/* Mobile top nav */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-4 border-b bg-card px-4 md:hidden">
          <Aperture className="size-5 text-primary" />
          {NAV.map(({ href, label }) => (
            <Link key={href} href={href} className="text-sm text-muted-foreground">
              {label}
            </Link>
          ))}
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
