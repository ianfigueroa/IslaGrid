"""Server-role Supabase client. Service key bypasses RLS — server use only."""

from __future__ import annotations

import os
from functools import lru_cache

from supabase import Client, create_client


@lru_cache(maxsize=1)
def supabase() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", url),
            ("SUPABASE_SERVICE_ROLE_KEY", key),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"missing required environment variable(s): {', '.join(missing)}"
        )
    return create_client(url, key)
