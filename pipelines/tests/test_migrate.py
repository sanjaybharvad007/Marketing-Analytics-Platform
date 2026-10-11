from pathlib import Path

import pytest

from map_pipelines.config import REPO_ROOT
from map_pipelines.migrate import MigrationError, discover


def test_discover_orders_by_filename(tmp_path: Path) -> None:
    for name in ("0002_b.sql", "0010_d.sql", "0001_a.sql", "notes.txt"):
        (tmp_path / name).write_text("SELECT 1;")
    assert [m.version for m in discover(tmp_path)] == ["0001_a", "0002_b", "0010_d"]


def test_checksum_changes_with_content(tmp_path: Path) -> None:
    path = tmp_path / "0001_a.sql"
    path.write_text("SELECT 1;")
    before = discover(tmp_path)[0].checksum
    path.write_text("SELECT 2;")
    assert discover(tmp_path)[0].checksum != before


def test_missing_directory_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(MigrationError, match="not found"):
        discover(tmp_path / "nope")


def test_repository_migrations_are_sequential() -> None:
    versions = [m.version for m in discover(REPO_ROOT / "db" / "migrations")]
    assert versions == sorted(versions)
    assert [int(v.split("_")[0]) for v in versions] == list(range(1, len(versions) + 1))
