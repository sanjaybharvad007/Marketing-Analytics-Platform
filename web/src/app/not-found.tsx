import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ui/panel";

export default function NotFound() {
  return (
    <Panel className="mx-auto mt-16 max-w-lg">
      <EmptyState
        title="This page is not on the map"
        titleAs="h1"
        action={
          <Link href="/" className={buttonClass("primary")}>
            Go to overview
          </Link>
        }
      >
        The address may be mistyped, or the page may have moved.
      </EmptyState>
    </Panel>
  );
}
