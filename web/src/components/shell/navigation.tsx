"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useTransition,
} from "react";
import { cn } from "@/lib/cn";

interface FilterNavigation {
  /** Navigate to the current path with new search params, keeping scroll position. */
  navigate: (params: URLSearchParams) => void;
  isPending: boolean;
}

const FilterNavigationContext = createContext<FilterNavigation | null>(null);

/**
 * Wraps a page whose content depends on URL filters. Filter controls call
 * `navigate`; while the server renders the new slice, `PendingRegion` dims the
 * previous content instead of replacing it with a skeleton.
 */
export function FilterScope({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      startTransition(() => {
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router],
  );

  const value = useMemo(() => ({ navigate, isPending }), [navigate, isPending]);
  return (
    <FilterNavigationContext.Provider value={value}>{children}</FilterNavigationContext.Provider>
  );
}

export function useFilterNavigation(): FilterNavigation {
  const value = useContext(FilterNavigationContext);
  if (!value) throw new Error("useFilterNavigation must be used inside <FilterScope>");
  return value;
}

export function PendingRegion({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { isPending } = useFilterNavigation();
  return (
    <div data-pending={isPending} aria-busy={isPending} className={cn(className)}>
      {children}
    </div>
  );
}
