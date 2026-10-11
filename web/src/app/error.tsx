"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ui/panel";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Panel className="mx-auto mt-16 max-w-lg">
      <EmptyState
        title="This page could not be loaded"
        titleAs="h1"
        action={
          <Button variant="primary" onClick={() => retry()}>
            Try again
          </Button>
        }
      >
        The request failed, most often because the database is not reachable. Check that PostgreSQL
        is running and that migrations have been applied, then try again.
        {error.digest ? (
          <span className="mt-2 block text-xs">Reference: {error.digest}</span>
        ) : null}
      </EmptyState>
    </Panel>
  );
}
