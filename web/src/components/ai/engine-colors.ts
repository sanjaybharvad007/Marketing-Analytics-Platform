import type { Engine } from "@/lib/domain";

/** Each engine keeps its colour slot whichever engines are filtered in. */
export const ENGINE_COLORS: Record<Engine, string> = {
  chatgpt: "var(--series-1)",
  perplexity: "var(--series-2)",
  gemini: "var(--series-3)",
  google_ai_overviews: "var(--series-4)",
  claude: "var(--series-5)",
};
