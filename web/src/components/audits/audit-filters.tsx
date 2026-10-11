"use client";

import { useFilterNavigation } from "@/components/shell/navigation";
import { Input, Select } from "@/components/ui/field";
import { humanize, ISSUE_STATUSES, SEVERITIES, SEVERITY_LABELS } from "@/lib/domain";
import { type AuditsPageState, auditsStateToParams } from "@/lib/filters/audits";

export function AuditFilters({ state, rules }: { state: AuditsPageState; rules: string[] }) {
  const { navigate } = useFilterNavigation();
  const update = (changes: Partial<AuditsPageState>) =>
    navigate(auditsStateToParams({ ...state, ...changes, page: 1 }));
  const filtered = Boolean(state.severity || state.rule || state.status || state.q);

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-4 pb-3"
      role="search"
      aria-label="Issue filters"
    >
      <div className="w-56">
        <label htmlFor="issue-search" className="sr-only">
          Search issues
        </label>
        <Input
          id="issue-search"
          type="search"
          placeholder="Search URL or message"
          defaultValue={state.q ?? ""}
          key={state.q ?? ""}
          onKeyDown={(event) => {
            if (event.key === "Enter") update({ q: event.currentTarget.value.trim() || undefined });
          }}
        />
      </div>
      <div className="w-36">
        <label htmlFor="issue-severity" className="sr-only">
          Severity
        </label>
        <Select
          id="issue-severity"
          value={state.severity ?? ""}
          onChange={(event) =>
            update({ severity: (event.target.value || undefined) as AuditsPageState["severity"] })
          }
        >
          <option value="">All severities</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_LABELS[severity]}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-56">
        <label htmlFor="issue-rule" className="sr-only">
          Rule
        </label>
        <Select
          id="issue-rule"
          value={state.rule ?? ""}
          onChange={(event) => update({ rule: event.target.value || undefined })}
        >
          <option value="">All rules</option>
          {rules.map((rule) => (
            <option key={rule} value={rule}>
              {humanize(rule)}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-36">
        <label htmlFor="issue-status" className="sr-only">
          Status
        </label>
        <Select
          id="issue-status"
          value={state.status ?? ""}
          onChange={(event) =>
            update({ status: (event.target.value || undefined) as AuditsPageState["status"] })
          }
        >
          <option value="">All statuses</option>
          {ISSUE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </Select>
      </div>
      {filtered ? (
        <button
          type="button"
          onClick={() => navigate(auditsStateToParams({}))}
          className="rounded-sm px-1 text-sm text-accent-text hover:underline"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
