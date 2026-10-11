"""`map` command line interface."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from enum import StrEnum
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from map_pipelines import demo_site
from map_pipelines.api_client import ApiError, PlatformApi
from map_pipelines.audit.runner import publish as publish_audit
from map_pipelines.audit.runner import run_audit
from map_pipelines.briefs.runner import fulfil_requested_briefs
from map_pipelines.config import Settings, get_settings
from map_pipelines.db import Database, fetch_all
from map_pipelines.demo.workspace import seed_audit_history, seed_workspace
from map_pipelines.digest.build import build_digest
from map_pipelines.etl.pipelines import (
    PIPELINE_ORDER,
    SeoPipeline,
    default_window,
    demo_world,
    transform_context,
)
from map_pipelines.etl.runner import RunOutcome, run_many, run_pipeline
from map_pipelines.llm import build_provider
from map_pipelines.logs import configure_logging
from map_pipelines.migrate import MigrationError, apply_migrations
from map_pipelines.models import DateWindow, PipelineName
from map_pipelines.opportunities.runner import detect, file_opportunities
from map_pipelines.prompts import PromptFileError, import_prompts, read_prompts_csv
from map_pipelines.sources.seo_csv import (
    SeoRowsSource,
    date_from_filename,
    decode_export,
    read_keyword_csv,
    resolve_mapping,
)
from map_pipelines.transform.urls import is_local_origin

app = typer.Typer(
    help="Pipelines, audits and content automation for the Marketing Analytics Platform.",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()


class Mode(StrEnum):
    demo = "demo"
    live = "live"


class PipelineChoice(StrEnum):
    ga4 = "ga4"
    gsc = "gsc"
    seo = "seo"
    ai_visibility = "ai-visibility"
    all = "all"


_PIPELINE_NAMES: dict[PipelineChoice, PipelineName] = {
    PipelineChoice.ga4: "ga4",
    PipelineChoice.gsc: "gsc",
    PipelineChoice.seo: "seo",
    PipelineChoice.ai_visibility: "ai_visibility",
}


@app.callback()
def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_format, settings.log_level)


def _api(settings: Settings) -> PlatformApi:
    return PlatformApi(settings.api_base_url, settings.api_token)


def _fail(message: str) -> typer.Exit:
    console.print(f"[red]error:[/red] {message}")
    return typer.Exit(code=1)


def _print_outcomes(outcomes: list[RunOutcome]) -> None:
    table = Table("Pipeline", "Status", "Rows loaded", "Rejected", "Seconds", "Error")
    for outcome in outcomes:
        table.add_row(
            outcome.pipeline,
            outcome.status,
            f"{outcome.rows_loaded:,}",
            str(outcome.rows_rejected),
            f"{outcome.seconds:.1f}",
            (outcome.error or "")[:80],
        )
    console.print(table)


# --- database -----------------------------------------------------------------


@app.command()
def migrate() -> None:
    """Apply pending SQL migrations from db/migrations."""
    settings = get_settings()
    with Database(settings.database_url, max_size=1) as db, db.connection() as conn:
        try:
            applied = apply_migrations(conn, settings.migrations_dir)
        except MigrationError as error:
            raise _fail(str(error)) from error
    if applied:
        console.print(f"Applied {len(applied)} migration(s): {', '.join(applied)}")
    else:
        console.print("Database is up to date.")


@app.command()
def status() -> None:
    """Show data freshness per source."""
    settings = get_settings()
    with Database(settings.database_url, max_size=1) as db, db.connection() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT p.pipeline,
                   last.mode, last.status, last.finished_at, last.rows_loaded, last.window_end,
                   ok.finished_at AS last_success
            FROM unnest(%s::text[]) AS p(pipeline)
            LEFT JOIN LATERAL (
                SELECT * FROM pipeline_runs r WHERE r.pipeline = p.pipeline
                ORDER BY r.started_at DESC LIMIT 1
            ) last ON true
            LEFT JOIN LATERAL (
                SELECT finished_at FROM pipeline_runs r
                WHERE r.pipeline = p.pipeline AND r.status = 'success'
                ORDER BY r.started_at DESC LIMIT 1
            ) ok ON true
            """,
            (list(PIPELINE_ORDER),),
        )
        newest = dict(
            fetch_all(
                conn,
                """
                SELECT 'ga4', max(date) FROM ga_daily
                UNION ALL SELECT 'gsc', max(date) FROM gsc_daily
                UNION ALL SELECT 'seo', max(date) FROM keyword_rankings
                UNION ALL SELECT 'ai_visibility', max(date) FROM ai_visibility_results
                """,
            )
        )
    table = Table("Source", "Mode", "Last run", "Finished", "Rows", "Newest data", "Days behind")
    today = date.today()
    for pipeline, mode, state, finished, rows_loaded, _window_end, _last_success in rows:
        newest_date = newest.get(pipeline)
        behind = "" if newest_date is None else str((today - newest_date).days)
        table.add_row(
            pipeline,
            mode or "-",
            state or "never run",
            finished.strftime("%Y-%m-%d %H:%M") if isinstance(finished, datetime) else "-",
            f"{rows_loaded:,}" if rows_loaded is not None else "-",
            str(newest_date or "-"),
            behind,
        )
    console.print(table)


# --- pipelines ----------------------------------------------------------------


def _window(
    settings: Settings, mode: Mode, days: int, start: datetime | None, end: datetime | None
) -> DateWindow:
    if start or end:
        if not (start and end):
            raise typer.BadParameter("--from and --to must be given together")
        return DateWindow(start=start.date(), end=end.date())
    return default_window(days, mode.value, settings)


@app.command()
def run(
    pipeline: Annotated[PipelineChoice, typer.Argument(help="Which pipeline to run.")],
    mode: Annotated[
        Mode, typer.Option(help="demo generates data, live calls the APIs.")
    ] = Mode.demo,
    days: Annotated[
        int, typer.Option(min=1, help="Trailing days to (re)load, ending yesterday.")
    ] = 3,
    start: Annotated[
        datetime | None, typer.Option("--from", formats=["%Y-%m-%d"], help="Backfill start date.")
    ] = None,
    end: Annotated[
        datetime | None, typer.Option("--to", formats=["%Y-%m-%d"], help="Backfill end date.")
    ] = None,
    fail_fast: Annotated[
        bool, typer.Option("--fail-fast", help="Stop at the first failed pipeline.")
    ] = False,
) -> None:
    """Extract, transform and load one pipeline or all of them.

    The default window re-pulls the last three days because search data keeps
    changing for a couple of days after it is first reported.
    """
    settings = get_settings()
    window = _window(settings, mode, days, start, end)
    names = list(PIPELINE_ORDER) if pipeline is PipelineChoice.all else [_PIPELINE_NAMES[pipeline]]
    with Database(settings.database_url) as db:
        outcomes = run_many(db, names, mode.value, window, settings, fail_fast=fail_fast)
    console.print(f"Window {window.start} to {window.end} ({mode.value} mode)")
    _print_outcomes(outcomes)
    if not all(outcome.ok for outcome in outcomes):
        raise typer.Exit(code=1)


@app.command("import-seo-csv")
def import_seo_csv(
    file: Annotated[Path, typer.Argument(exists=True, dir_okay=False, help="Keyword export.")],
    mapping: Annotated[
        str, typer.Option(help="Preset name (semrush, ahrefs) or path to a JSON column mapping.")
    ] = "semrush",
    snapshot_date: Annotated[
        datetime | None,
        typer.Option("--date", formats=["%Y-%m-%d"], help="Date for rows without one."),
    ] = None,
) -> None:
    """Load one SEO-tool keyword export (Semrush or Ahrefs style CSV)."""
    settings = get_settings()
    try:
        column_mapping = resolve_mapping(mapping)
    except ValueError as error:
        raise _fail(str(error)) from error
    day = snapshot_date.date() if snapshot_date else date_from_filename(file.name) or date.today()
    rows = list(read_keyword_csv(decode_export(file.read_bytes()), column_mapping, day))
    if not rows:
        raise _fail("no keyword rows found in the export")
    dates = [row["date"] for row in rows]
    window = DateWindow(start=min(dates), end=max(dates))

    with Database(settings.database_url) as db:
        outcome = run_pipeline(
            db, SeoPipeline(SeoRowsSource(rows), transform_context(settings)), "live", window
        )
    _print_outcomes([outcome])
    if not outcome.ok:
        raise typer.Exit(code=1)


@app.command("import-prompts")
def import_prompts_command(
    file: Annotated[
        Path,
        typer.Argument(exists=True, dir_okay=False, help="CSV with prompt, topic[, intent]."),
    ],
    replace: Annotated[
        bool, typer.Option("--replace", help="Deactivate tracked prompts that are not in the file.")
    ] = False,
) -> None:
    """Load the prompts the AI-visibility pipeline asks each answer engine."""
    settings = get_settings()
    try:
        rows = read_prompts_csv(decode_export(file.read_bytes()))
    except PromptFileError as error:
        raise _fail(str(error)) from error
    if not rows:
        raise _fail("the file has no prompts")
    with Database(settings.database_url, max_size=1) as db, db.connection() as conn:
        result = import_prompts(conn, rows, deactivate_missing=replace)
    console.print(
        f"{result.added} prompt(s) added, {result.updated} updated, "
        f"{result.deactivated} deactivated."
    )


@app.command("seed-demo")
def seed_demo(
    days: Annotated[int, typer.Option(min=7, help="Days of history to generate.")] = 120,
    reset: Annotated[bool, typer.Option("--reset", help="Empty every table first.")] = False,
) -> None:
    """Migrate, then load demo data for every source plus the demo workspace."""
    settings = get_settings()
    world = demo_world(settings)
    window = DateWindow.trailing(days, world.anchor - timedelta(days=1))
    with Database(settings.database_url) as db:
        with db.connection() as conn:
            applied = apply_migrations(conn, settings.migrations_dir)
        if applied:
            console.print(f"Applied {len(applied)} migration(s).")
        if reset:
            with db.connection() as conn:
                conn.execute(
                    """
                    TRUNCATE pages, members, pipeline_runs, keywords, domain_metrics_daily,
                             ai_prompts, content_plans, audit_runs, tasks, saved_views
                    RESTART IDENTITY CASCADE
                    """
                )
            console.print("Emptied all tables.")

        outcomes = run_many(
            db, list(PIPELINE_ORDER), "demo", window, settings, fail_fast=True, world=world
        )
        _print_outcomes(outcomes)
        if not all(outcome.ok for outcome in outcomes):
            raise typer.Exit(code=1)

        with db.connection() as conn:
            if conn.execute("SELECT count(*) FROM members").fetchone()[0] == 0:
                counts = seed_workspace(conn, world)
                counts["audit_runs"] = seed_audit_history(conn, world)
                console.print(
                    "Workspace seeded: " + ", ".join(f"{n} {name}" for name, n in counts.items())
                )
            else:
                console.print("Workspace tables already have data; left untouched.")
    console.print(f"Demo data covers {window.start} to {window.end}.")


# --- demo site ----------------------------------------------------------------


@app.command("serve-demo-site")
def serve_demo_site(
    port: Annotated[int, typer.Option(help="Port to listen on.")] = 8200,
    host: Annotated[str, typer.Option(help="Interface to bind.")] = "127.0.0.1",
    directory: Annotated[
        Path, typer.Option("--dir", help="Site directory.")
    ] = demo_site.DEFAULT_SITE_DIR,
) -> None:
    """Serve the bundled Northpeak demo site so `map audit` has something to crawl."""
    server = demo_site.make_server(demo_site.StaticSite(directory), host, port)
    console.print(f"Serving {directory} at http://{host}:{port}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


# --- AI-assisted scripts --------------------------------------------------------


@app.command()
def audit(
    url: Annotated[str, typer.Option(help="Where to start crawling.")] = "http://localhost:8200/",
    public_origin: Annotated[
        str | None,
        typer.Option(
            help="Origin the site is published under. Defaults to SITE_URL when crawling "
            "a local copy (localhost or a container name), otherwise to the crawled origin."
        ),
    ] = None,
    max_pages: Annotated[int, typer.Option(min=1)] = 500,
    concurrency: Annotated[int, typer.Option(min=1, max=32)] = 5,
    publish: Annotated[
        bool, typer.Option("--publish/--no-publish", help="Store the run through the API.")
    ] = True,
) -> None:
    """Crawl a site, run the technical SEO rules, and publish the results."""
    settings = get_settings()
    if public_origin is None and is_local_origin(url):
        public_origin = settings.site_url
    report = asyncio.run(
        run_audit(
            url,
            build_provider(settings),
            public_origin=public_origin,
            concurrency=concurrency,
            max_pages=max_pages,
        )
    )
    if report.pages_crawled == 0:
        raise _fail(f"no pages could be crawled at {url}. Is the site running?")

    table = Table("Severity", "Rule", "Pages")
    counts: dict[tuple[str, str], int] = {}
    for issue in report.issues:
        counts[(issue.severity, issue.rule)] = counts.get((issue.severity, issue.rule), 0) + 1
    for (severity, rule), count in counts.items():
        table.add_row(severity, rule, str(count))
    console.print(table)
    console.print(
        f"Crawled {report.pages_crawled} pages, {len(report.issues)} issues, "
        f"health score {report.health_score:.1f} (summary by {report.summary_source})."
    )
    console.print(report.summary.to_text())

    if publish:
        try:
            result = publish_audit(_api(settings), report)
        except ApiError as error:
            raise _fail(f"could not publish the audit: {error}") from error
        console.print(
            f"Published as audit run {result.run_id}: {result.tasks_created} task(s) opened, "
            f"{result.tasks_existing} already existed."
        )


@app.command()
def briefs(limit: Annotated[int, typer.Option(min=1)] = 20) -> None:
    """Write content briefs for plans whose brief was requested in the planner."""
    settings = get_settings()
    try:
        outcomes = fulfil_requested_briefs(
            _api(settings), build_provider(settings), brand_name=settings.brand_name, limit=limit
        )
    except ApiError as error:
        raise _fail(str(error)) from error
    if not outcomes:
        console.print("No briefs are waiting. Request one from the planner first.")
        return
    table = Table("Plan", "Title", "Result", "Written by")
    for outcome in outcomes:
        table.add_row(
            str(outcome.plan_id), outcome.title, outcome.status, outcome.source or outcome.error
        )
    console.print(table)
    if any(outcome.status == "failed" for outcome in outcomes):
        raise typer.Exit(code=1)


@app.command()
def opportunities(
    date_range: Annotated[str, typer.Option("--range", help="Reporting window.")] = "28d",
    per_kind: Annotated[int, typer.Option(min=1, help="Records to file per kind.")] = 8,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Detect only.")] = False,
) -> None:
    """Find striking-distance queries, decaying pages and AI-visibility gaps."""
    settings = get_settings()
    api = _api(settings)
    try:
        found = detect(api, date_range=date_range)
        filed = [] if dry_run else file_opportunities(api, found, per_kind=per_kind)
    except ApiError as error:
        raise _fail(str(error)) from error

    table = Table("Kind", "Opportunity", "Score", "Filed as")
    filed_by_key = {item.opportunity.key: item for item in filed}
    for opportunity in found:
        item = filed_by_key.get(opportunity.key)
        if item is None:
            outcome = "-"
        else:
            outcome = f"{item.target} {item.record_id} ({'new' if item.created else 'existing'})"
        table.add_row(opportunity.kind, opportunity.title, f"{opportunity.score:,.1f}", outcome)
    console.print(table)
    created = sum(1 for item in filed if item.created)
    console.print(
        f"{len(found)} opportunities found; {created} new record(s) created, "
        f"{len(filed) - created} already existed."
    )


@app.command()
def digest(
    date_range: Annotated[str, typer.Option("--range", help="Reporting window.")] = "7d",
    output: Annotated[
        Path | None, typer.Option(help="File to write. Defaults to reports/digest-<date>.md.")
    ] = None,
) -> None:
    """Write the weekly Markdown digest to a file and print it."""
    settings = get_settings()
    try:
        data, markdown = build_digest(_api(settings), build_provider(settings), date_range)
    except ApiError as error:
        raise _fail(str(error)) from error
    path = output or settings.digest_output_dir / f"digest-{data.period['to']}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(markdown, encoding="utf-8")
    # Plain stdout, unwrapped, so the digest can be piped or redirected as it is.
    typer.echo(markdown, nl=False)
    typer.echo(f"Written to {path}", err=True)


if __name__ == "__main__":
    app()
