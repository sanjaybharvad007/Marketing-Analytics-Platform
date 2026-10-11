import { Badge } from "@/components/ui/badge";
import type { ContentBrief } from "@/lib/api/schemas";
import { humanize } from "@/lib/domain";
import { formatDateTime, formatInteger } from "@/lib/format";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-3.5 first:border-t-0 first:pt-0">
      <h3 className="narrow mb-1.5 text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Renders a structured content brief as a document a writer can work from. */
export function BriefView({ brief }: { brief: ContentBrief }) {
  const ranking = brief.current_ranking;
  return (
    <div className="text-sm leading-6">
      <Section title="Target">
        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-ink-3">Primary keyword</dt>
          <dd className="font-medium">{brief.primary_keyword}</dd>
          <dt className="text-ink-3">Search intent</dt>
          <dd>{humanize(brief.search_intent)}</dd>
          <dt className="text-ink-3">Target length</dt>
          <dd className="num">{formatInteger(brief.target_word_count)} words</dd>
          <dt className="text-ink-3">Current ranking</dt>
          <dd className="num">
            {ranking.position
              ? `Position ${Math.round(ranking.position)}${ranking.url ? ` with ${ranking.url.replace(/^https?:\/\/[^/]+/, "")}` : ""}`
              : "Not ranking in the tracked depth"}
            {ranking.search_volume
              ? `, ${formatInteger(ranking.search_volume)} searches a month`
              : ""}
          </dd>
        </dl>
        <p className="mt-2 text-ink-2">{brief.intent_summary}</p>
      </Section>

      <Section title="Working titles">
        <ul className="list-disc pl-5">
          {brief.working_titles.map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ul>
      </Section>

      <Section title="Outline">
        <ol className="flex flex-col gap-1.5">
          {brief.outline.map((section, index) => (
            <li key={`${index}-${section.heading}`}>
              <p>
                <span className="num mr-2 text-xs text-ink-3">H2</span>
                <span className="font-medium">{section.heading}</span>
              </p>
              {section.subheadings.length > 0 ? (
                <ul className="mt-0.5 ml-6 flex flex-col">
                  {section.subheadings.map((heading) => (
                    <li key={heading} className="text-ink-2">
                      <span className="num mr-2 text-xs text-ink-3">H3</span>
                      {heading}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      {brief.questions.length > 0 ? (
        <Section title="Questions to answer">
          <ul className="list-disc pl-5">
            {brief.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.secondary_keywords.length > 0 || brief.entities.length > 0 ? (
        <Section title="Keywords and terms to cover">
          {brief.secondary_keywords.length > 0 ? (
            <p className="mb-1.5 flex flex-wrap gap-1">
              {brief.secondary_keywords.map((keyword) => (
                <Badge key={keyword} tone="accent">
                  {keyword}
                </Badge>
              ))}
            </p>
          ) : null}
          {brief.entities.length > 0 ? (
            <p className="flex flex-wrap gap-1">
              {brief.entities.map((entity) => (
                <Badge key={entity}>{entity}</Badge>
              ))}
            </p>
          ) : null}
        </Section>
      ) : null}

      {brief.internal_links.length > 0 ? (
        <Section title="Internal links">
          <ul className="flex flex-col gap-1.5">
            {brief.internal_links.map((link) => (
              <li key={link.url}>
                <p className="font-medium">{link.title}</p>
                <p className="truncate text-xs text-ink-3">{link.url}</p>
                <p className="text-ink-2">{link.reason}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Meta description draft">
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2">
          {brief.meta_description}
        </p>
        <p className="num mt-1 text-xs text-ink-3">{brief.meta_description.length} characters</p>
      </Section>

      {brief.generated_by ? (
        <p className="border-t border-line pt-3 text-xs text-ink-3">
          Written by{" "}
          {brief.generated_by === "llm"
            ? "the configured language model"
            : "the rule-based builder"}
          {brief.generated_at ? ` on ${formatDateTime(brief.generated_at)}` : ""}. Review before
          handing it to a writer.
        </p>
      ) : null}
    </div>
  );
}
