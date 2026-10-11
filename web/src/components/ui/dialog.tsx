"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `panel` slides in from the right and suits read-heavy detail views. */
  variant?: "modal" | "panel";
  size?: "md" | "lg";
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  variant = "modal",
  size = "md",
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content
          aria-describedby={description ? undefined : undefined}
          className={cn(
            "fixed z-50 flex flex-col border border-line bg-surface text-ink shadow-xl",
            variant === "modal"
              ? cn(
                  "top-[6vh] left-1/2 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg",
                  size === "lg" ? "max-w-3xl" : "max-w-xl",
                )
              : "inset-y-0 right-0 w-full max-w-xl border-y-0 border-r-0",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <RadixDialog.Title className="narrow text-lg leading-6 font-semibold">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-sm text-ink-3">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-1.5 rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink"
            >
              <X aria-hidden="true" className="size-4" />
            </RadixDialog.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
