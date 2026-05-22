"""Regression tests for the municipality matcher used in outage_events.

The matcher converts an outage text snippet and a {muni-slug: muni-id}
index into a municipality_id. Before the whole-word fix, a bare substring
check would accept "san-juan" inside "san-juanito" and similar overlapping
slugs. These tests pin the new behavior: dash-bounded whole-word match,
longest-token-first preference.
"""

from __future__ import annotations

import pytest

from ingestion.src.pipeline.outage_events import _find_municipality


@pytest.fixture
def muni_index() -> dict[str, str]:
    """Subset of the real PR muni slug→id mapping, enough to exercise edges."""
    return {
        "san-juan": "san-juan",
        "san-german": "san-german",
        "san-sebastian": "san-sebastian",
        "ponce": "ponce",
        "bayamon": "bayamon",
        "carolina": "carolina",
    }


def test_matches_exact_muni_name(muni_index: dict[str, str]) -> None:
    assert _find_municipality("Outage in San Juan tonight", muni_index) == "san-juan"


def test_rejects_overlapping_longer_slug(muni_index: dict[str, str]) -> None:
    # "San Juanito" must not match "san-juan".
    assert _find_municipality("Incidente en San Juanito", muni_index) is None


def test_longest_token_wins(muni_index: dict[str, str]) -> None:
    # "San German" should win over any shorter accidental overlap.
    assert _find_municipality("Mantenimiento en San German manana", muni_index) == "san-german"


def test_no_false_positive_from_unrelated_word(muni_index: dict[str, str]) -> None:
    # The dashed token "ponce" must not match "Ponce de Leon Boulevard" content
    # only when the surrounding text actually contains it as a whole token.
    # Here we craft text where 'ponce' appears as a complete word.
    assert _find_municipality("Falla en Ponce sector sur", muni_index) == "ponce"


def test_returns_none_when_no_match(muni_index: dict[str, str]) -> None:
    assert _find_municipality("Generic system update with no muni named", muni_index) is None


def test_short_tokens_are_ignored(muni_index: dict[str, str]) -> None:
    # Tokens shorter than 3 chars are skipped to avoid pathological matches.
    idx = {**muni_index, "rp": "rp-test", "x": "x-test"}
    assert _find_municipality("Mention of rp and x somewhere", idx) is None
