"use server";

import { revalidatePath } from "next/cache";
import { issuePatchSchema } from "@/lib/api/schemas";
import { humanize } from "@/lib/domain";
import { type AuditIssue, getIssue, updateIssueStatus } from "@/lib/services/audits";
import { createTask, type Task } from "@/lib/services/tasks";
import { type ActionResult, runAction } from "./result";

export async function setIssueStatusAction(
  id: number,
  status: unknown,
): Promise<ActionResult<AuditIssue>> {
  return runAction(async () => {
    const issue = await updateIssueStatus(id, issuePatchSchema.parse({ status }).status);
    revalidatePath("/audits");
    revalidatePath("/");
    return issue;
  });
}

/**
 * Open a task for an issue. The dedupe key matches the one `map audit` uses,
 * so the same issue never gets two tasks whichever side creates it first.
 */
export async function createTaskFromIssueAction(
  id: number,
): Promise<ActionResult<{ task: Task; existing: boolean }>> {
  return runAction(async () => {
    const issue = await getIssue(id);
    const { record, deduplicated } = await createTask({
      title: `${humanize(issue.rule)}: ${issue.path || "/"}`.slice(0, 200),
      description: `${issue.message}\n\nURL: ${issue.url}`,
      status: "todo",
      priority:
        issue.severity === "critical"
          ? "urgent"
          : issue.severity === "low"
            ? "low"
            : issue.severity,
      labels: ["technical-seo"],
      source: "audit",
      dedupe_key: `audit:${issue.rule}:${issue.url}`,
      audit_issue_id: issue.id,
      page_id: issue.page_id,
      evidence: { rule: issue.rule, severity: issue.severity, ...issue.details },
    });
    revalidatePath("/audits");
    revalidatePath("/work");
    return { task: record, existing: deduplicated };
  });
}
