/** Value sets shared by the database schema, validation and the UI. */

export const DEVICES = ["desktop", "mobile", "tablet"] as const;
export type Device = (typeof DEVICES)[number];

export const PAGE_TYPES = [
  "home",
  "landing",
  "category",
  "product",
  "article",
  "guide",
  "store",
  "other",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const INTENTS = ["informational", "commercial", "transactional", "navigational"] as const;
export type Intent = (typeof INTENTS)[number];

export const ENGINES = [
  "chatgpt",
  "perplexity",
  "gemini",
  "google_ai_overviews",
  "claude",
] as const;
export type Engine = (typeof ENGINES)[number];

export const ENGINE_LABELS: Record<Engine, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  google_ai_overviews: "Google AI Overviews",
  claude: "Claude",
};

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const PLAN_STATUSES = [
  "idea",
  "brief",
  "draft",
  "review",
  "scheduled",
  "published",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  idea: "Idea",
  brief: "Brief",
  draft: "Draft",
  review: "Review",
  scheduled: "Scheduled",
  published: "Published",
};

export const BRIEF_STATUSES = ["none", "requested", "ready", "failed"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

export const TASK_SOURCES = ["manual", "audit", "ai", "opportunity"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TASK_SOURCE_LABELS: Record<TaskSource, string> = {
  manual: "Manual",
  audit: "Audit",
  ai: "AI",
  opportunity: "Opportunity",
};

export const PLAN_SOURCES = ["manual", "opportunity", "ai"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const ISSUE_STATUSES = ["open", "ignored", "fixed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const PIPELINES = ["ga4", "gsc", "seo", "ai_visibility"] as const;
export type PipelineName = (typeof PIPELINES)[number];

export const PIPELINE_LABELS: Record<PipelineName, string> = {
  ga4: "Web analytics (GA4)",
  gsc: "Search Console",
  seo: "SEO tool",
  ai_visibility: "AI visibility",
};

export const RUN_STATUSES = ["running", "success", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const REPORTS = ["seo", "ai_visibility"] as const;
export type Report = (typeof REPORTS)[number];

export const COUNTRY_LABELS: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  DE: "Germany",
  AU: "Australia",
  ZZ: "Unknown",
};

export function countryLabel(code: string): string {
  return COUNTRY_LABELS[code] ?? code;
}

const ACRONYMS: Record<string, string> = {
  ai: "AI",
  cpc: "CPC",
  ctr: "CTR",
  h1: "H1",
  seo: "SEO",
  serp: "SERP",
  url: "URL",
};

/** "sitemap_url_error" -> "Sitemap URL error"; used for rule, label and enum slugs. */
export function humanize(slug: string): string {
  const words = slug
    .replace(/[_-]+/g, " ")
    .trim()
    .split(" ")
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
