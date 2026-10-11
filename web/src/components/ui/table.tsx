import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatInteger } from "@/lib/format";
import { buttonClass } from "./button";

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("scroll-thin overflow-x-auto", className)}>{children}</div>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn("w-full border-collapse text-sm", className)}>{children}</table>;
}

export function Th({
  children,
  align = "left",
  className,
  sort,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  /** Makes the header a sort link. `active` is the current direction, if sorted by this column. */
  sort?: { href: string; active: "asc" | "desc" | null };
}) {
  const Icon =
    sort?.active === "asc" ? ArrowUp : sort?.active === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={
        sort?.active === "asc" ? "ascending" : sort?.active === "desc" ? "descending" : undefined
      }
      className={cn(
        "narrow border-b border-line bg-surface-2 px-3 py-2 text-xs font-semibold whitespace-nowrap text-ink-2",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {sort ? (
        <Link
          href={sort.href}
          scroll={false}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm hover:text-ink",
            align === "right" && "flex-row-reverse",
            sort.active && "text-ink",
          )}
        >
          {children}
          <Icon aria-hidden="true" className={cn("size-3", !sort.active && "opacity-50")} />
        </Link>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
  colSpan,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "border-b border-line px-3 py-2 align-middle",
        align === "right" && "num text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-ink-3"
    >
      <p className="num">
        {formatInteger(first)}–{formatInteger(last)} of {formatInteger(total)}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} scroll={false} className={buttonClass("secondary", "sm")}>
            <ChevronLeft aria-hidden="true" className="size-3.5" />
            Previous
          </Link>
        ) : null}
        <span className="num px-2">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} scroll={false} className={buttonClass("secondary", "sm")}>
            Next
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
