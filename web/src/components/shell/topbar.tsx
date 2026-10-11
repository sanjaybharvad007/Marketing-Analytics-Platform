import { FlaskConical } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { WorkspaceStatus } from "@/lib/services/meta";
import { type Theme, ThemeToggle } from "./theme-toggle";

export function Topbar({
  workspace,
  siteUrl,
  status,
  dataThrough,
  theme,
}: {
  workspace: string;
  siteUrl: string;
  status: WorkspaceStatus;
  dataThrough: string;
  theme: Theme | null;
}) {
  const host = siteUrl.replace(/^https?:\/\//, "");
  return (
    <header className="sticky top-0 z-20 flex h-11 items-center justify-between gap-4 border-b border-line bg-page/90 px-4 backdrop-blur-sm md:px-6">
      <p className="min-w-0 truncate text-sm text-ink-2">
        <span className="font-semibold text-ink">{workspace}</span>
        <span className="mx-2 text-line-strong" aria-hidden="true">
          /
        </span>
        <span>{host}</span>
      </p>
      <div className="flex shrink-0 items-center gap-3">
        {status.hasData ? (
          <p className="hidden text-sm text-ink-3 sm:block">
            Data through <span className="num text-ink-2">{formatDate(dataThrough, "long")}</span>
          </p>
        ) : null}
        {status.demo ? (
          <span
            data-testid="demo-indicator"
            title="The latest pipeline runs loaded generated demo data, not data from live accounts."
            className="inline-flex h-6 items-center gap-1.5 rounded-md border border-(--warning) bg-warning-soft px-2 text-xs font-semibold text-warning-text"
          >
            <FlaskConical aria-hidden="true" className="size-3.5" />
            Demo data
          </span>
        ) : null}
        <ThemeToggle initial={theme} />
      </div>
    </header>
  );
}
