"use client";

import { ListPlus } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { Badge, SeverityLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { createTaskFromIssueAction, setIssueStatusAction } from "@/lib/actions/audits";
import { humanize, type IssueStatus } from "@/lib/domain";
import type { AuditIssue } from "@/lib/services/audits";

const STATUS_TONE: Record<IssueStatus, "warning" | "neutral" | "good"> = {
  open: "warning",
  ignored: "neutral",
  fixed: "good",
};

export function IssueTable({ issues }: { issues: AuditIssue[] }) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  function setStatus(issue: AuditIssue, status: IssueStatus) {
    startTransition(async () => {
      const result = await setIssueStatusAction(issue.id, status);
      if (result.ok) toast.success(`Issue marked ${status}`);
      else toast.error(result.message);
    });
  }

  function createTask(issue: AuditIssue) {
    startTransition(async () => {
      const result = await createTaskFromIssueAction(issue.id);
      if (!result.ok) toast.error(result.message);
      else if (result.data.existing) toast.success("A task for this issue already exists.");
      else toast.success(`Task created: ${result.data.task.title}`);
    });
  }

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>Severity</Th>
            <Th>Issue</Th>
            <Th>Page</Th>
            <Th>Status</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id} className="hover:bg-surface-2">
              <Td className="whitespace-nowrap">
                <SeverityLabel severity={issue.severity} />
              </Td>
              <Td className="max-w-md min-w-64">
                <span className="block font-medium">{humanize(issue.rule)}</span>
                <span className="block text-xs text-ink-3">{issue.message}</span>
              </Td>
              <Td className="max-w-72">
                <span className="block truncate" title={issue.url}>
                  {issue.path || "/"}
                </span>
              </Td>
              <Td>
                <Badge tone={STATUS_TONE[issue.status]}>{humanize(issue.status)}</Badge>
              </Td>
              <Td align="right">
                <span className="flex items-center justify-end gap-1">
                  {issue.status === "open" ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => setStatus(issue, "fixed")}
                      >
                        Mark fixed
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => setStatus(issue, "ignored")}
                      >
                        Ignore
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => setStatus(issue, "open")}
                    >
                      Reopen
                    </Button>
                  )}
                  {issue.task_id ? (
                    <Link
                      href={`/work?task=${issue.task_id}`}
                      className="px-2 text-sm whitespace-nowrap text-accent-text hover:underline"
                    >
                      View task
                    </Link>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      onClick={() => createTask(issue)}
                      aria-label={`Create a task for ${humanize(issue.rule)} on ${issue.path || "/"}`}
                    >
                      <ListPlus aria-hidden="true" className="size-3.5" />
                      Create task
                    </Button>
                  )}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
