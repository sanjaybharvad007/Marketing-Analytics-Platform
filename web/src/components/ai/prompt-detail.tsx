"use client";

import { Check, Link2, Minus } from "lucide-react";
import { useFilterNavigation } from "@/components/shell/navigation";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ENGINE_LABELS } from "@/lib/domain";
import { type AiPageState, aiStateToParams } from "@/lib/filters/ai";
import { formatDate } from "@/lib/format";
import type { PromptDetail } from "@/lib/services/ai-visibility";

const SENTIMENT_TONE = { positive: "good", neutral: "neutral", negative: "bad" } as const;

/** Side panel with the newest stored answer per engine for one prompt. */
export function PromptDetailPanel({ detail, state }: { detail: PromptDetail; state: AiPageState }) {
  const { navigate } = useFilterNavigation();
  return (
    <Dialog
      open
      variant="panel"
      onOpenChange={(open) => {
        if (!open) navigate(aiStateToParams({ ...state, prompt: undefined }));
      }}
      title={detail.prompt}
      description={`${detail.topic} prompt. The newest stored answer from each engine in the selected range.`}
    >
      {detail.answers.length === 0 ? (
        <p className="text-sm text-ink-3">
          No answers are stored for this prompt in the selected range.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {detail.answers.map((answer) => (
            <li key={answer.engine} className="rounded-lg border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2">
                <h3 className="narrow text-base font-semibold">{ENGINE_LABELS[answer.engine]}</h3>
                <span className="num text-xs text-ink-3">{formatDate(answer.date, "long")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
                {answer.brand_mentioned ? (
                  <Badge tone="good">
                    <Check aria-hidden="true" className="size-3" strokeWidth={3} />
                    Mentioned{answer.brand_rank ? `, named ${ordinal(answer.brand_rank)}` : ""}
                  </Badge>
                ) : (
                  <Badge>
                    <Minus aria-hidden="true" className="size-3" />
                    Not mentioned
                  </Badge>
                )}
                {answer.cited ? (
                  <Badge tone="accent">
                    <Link2 aria-hidden="true" className="size-3" />
                    Cited
                  </Badge>
                ) : null}
                {answer.sentiment ? (
                  <Badge tone={SENTIMENT_TONE[answer.sentiment]}>
                    {answer.sentiment.charAt(0).toUpperCase() + answer.sentiment.slice(1)} tone
                  </Badge>
                ) : null}
              </div>
              <blockquote className="px-3 py-2.5 text-sm leading-6 whitespace-pre-line text-ink-2">
                {answer.answer_excerpt}
              </blockquote>
              {answer.competitors_mentioned.length > 0 || answer.cited_url ? (
                <dl className="border-t border-line px-3 py-2 text-sm">
                  {answer.competitors_mentioned.length > 0 ? (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-ink-3">Competitors named</dt>
                      <dd>{answer.competitors_mentioned.join(", ")}</dd>
                    </div>
                  ) : null}
                  {answer.cited_url ? (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-ink-3">Cited URL</dt>
                      <dd className="min-w-0 truncate">{answer.cited_url}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function ordinal(rank: number): string {
  const suffix =
    rank % 10 === 1 && rank !== 11
      ? "st"
      : rank % 10 === 2 && rank !== 12
        ? "nd"
        : rank % 10 === 3 && rank !== 13
          ? "rd"
          : "th";
  return `${rank}${suffix}`;
}
