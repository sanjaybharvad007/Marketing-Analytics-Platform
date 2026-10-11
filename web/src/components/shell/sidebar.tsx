"use client";

import {
  CalendarRange,
  ChartNoAxesCombined,
  type LucideIcon,
  KanbanSquare,
  LoaderCircle,
  ScanSearch,
  Sparkles,
  TextSearch,
  Workflow,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Contours, Logo } from "./contours";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Reports",
    items: [
      { href: "/", label: "Overview", icon: ChartNoAxesCombined },
      { href: "/reports/seo", label: "SEO", icon: TextSearch },
      { href: "/reports/ai-visibility", label: "AI visibility", icon: Sparkles },
    ],
  },
  {
    label: "Plan and deliver",
    items: [
      { href: "/planner", label: "Planner", icon: CalendarRange },
      { href: "/work", label: "Work", icon: KanbanSquare },
    ],
  },
  {
    label: "Site health",
    items: [
      { href: "/audits", label: "Audits", icon: ScanSearch },
      { href: "/pipelines", label: "Pipelines", icon: Workflow },
    ],
  },
];

/** Shows a spinner in place of the icon while the linked route is loading. */
function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />
  ) : (
    <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
  );
}

export function Sidebar({ workspace }: { workspace: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-14 flex-col bg-sidebar text-sidebar-ink lg:w-[216px]">
      <div className="relative h-[72px] shrink-0 overflow-hidden border-b border-(--sidebar-line)">
        <Contours className="absolute inset-0 hidden h-full w-full text-(--sidebar-contour) lg:block" />
        <Link
          href="/"
          className="relative flex h-full items-center gap-2.5 px-3.5 lg:px-4"
          aria-label="MAP, Marketing Analytics Platform: overview"
        >
          <Logo className="size-7 shrink-0" />
          <span className="hidden min-w-0 lg:block">
            <span className="narrow block text-lg leading-5 font-bold tracking-wide">MAP</span>
            <span className="block truncate text-xs text-sidebar-muted">{workspace}</span>
          </span>
        </Link>
      </div>

      <nav aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
        {GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 hidden px-2 text-xs text-sidebar-muted lg:block">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={item.label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center justify-center gap-2.5 rounded-md text-sm lg:justify-start lg:px-2",
                        "outline-offset-[-2px] transition-colors",
                        active
                          ? "bg-sidebar-raised font-semibold text-white"
                          : "text-sidebar-muted hover:bg-sidebar-raised/60 hover:text-sidebar-ink",
                      )}
                    >
                      <NavIcon icon={item.icon} />
                      <span className="hidden lg:inline">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="hidden border-t border-(--sidebar-line) px-4 py-3 text-xs text-sidebar-muted lg:block">
        <a href="/api/v1/openapi.json" className="hover:text-sidebar-ink">
          REST API reference
        </a>
      </div>
    </aside>
  );
}
