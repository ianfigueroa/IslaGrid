"""Shared Playwright launch arguments for IslaGrid scrapers.

Centralizing this so the security trade-offs only have to be documented in
one place and the flag list stays consistent across every scraper.

Threat model
------------
All scrapers run inside the GitHub Actions ubuntu-latest runner, in a
fresh ephemeral container per job. They only ever load three well-known
upstream hosts (lumapr.com, miluma.lumapr.com, genera-pr.com) — none of
which is attacker-controlled. The container has no project secrets at all
beyond the Supabase service-role key, which Chromium has no business
touching from a page context.

Flag choices
------------
* ``--no-sandbox`` — the GitHub runner runs the container as root and
  Chromium's user-namespace sandbox refuses to initialize as root. Without
  this flag the launch fails outright. We accept the reduced exploit
  mitigation because the threat surface is a curated, ephemeral, secret-poor
  container; an exploit of e.g. miluma.lumapr.com would still be confined
  to one job, with no persistent state to steal.
* ``--disable-dev-shm-usage`` — the GitHub runner's ``/dev/shm`` is tiny
  (~64MB), which makes Chromium crash unpredictably under load. This flag
  spills shared memory to ``/tmp`` instead. Stability fix, not security.
* ``--disable-gpu`` — there's no GPU; saves the initialization time and
  silences a noisy warning in the logs.

If a scraper ever needs to load attacker-controlled content (a community
report URL preview, for example), introduce a *separate* launch profile
that keeps the sandbox on and runs in a less privileged container.
"""

from __future__ import annotations

# The argument list every scraper uses. Edit here, not in each call site.
BROWSER_ARGS: list[str] = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
]
