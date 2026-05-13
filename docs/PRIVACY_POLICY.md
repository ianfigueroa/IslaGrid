# Privacy Policy

*Last updated: 2026-05-11*

IslaGrid AI is a public, informational dashboard about Puerto Rico's electric grid. This page explains what we collect, what we do not collect, and how to remove your data.

## What we collect

- **Anonymous web analytics** via Vercel Web Analytics: page views, anonymized IP-derived country/region, browser type. No third-party trackers.
- **Account data**, if you create an account: an email address (used only for login + transactional messages) and a randomly generated user ID.
- **Community reports**, if you submit one: report type (e.g., "no power"), an H3 resolution-7 cell ID (~5 km² area) derived from the location you choose, and a timestamp. Your user ID is stored privately for spam control but is never returned in any public API response.
- **A hashed IP** per community report, used only for rate-limiting and spam control. The plain IP is never stored.

## What we do not collect

- **Exact home or device locations.** The submission flow rounds every location to an H3 res-7 cell before storing. The high-precision coordinate never reaches our database.
- **Third-party advertising or marketing trackers.**
- **Health data, financial data, or government IDs.**
- **Contents of other utility accounts** (we do not integrate with LUMA customer accounts).

## What we publish

- Aggregated counts of community reports per H3 cell, per municipality.
- Numbers and updates pulled from public official sources (`datos.pr.gov`, LUMA, NWS, PREB, OSM). These are clearly source-labeled.

## What we never publish

- Your user ID, email, or IP — hashed or otherwise.
- Your exact location.
- Pole-, transformer-, or feeder-level infrastructure information, even if it becomes available to us.

## Data retention

- Raw HTML/PDF/JSON snapshots from public sources are retained indefinitely (they are public data anyway).
- Community reports are retained for 2 years for trend analysis, then deleted automatically.
- Account data is retained until you request deletion.

## How to delete your data

Email **contact@islagrid.app** with the subject `IslaGrid AI: delete my account`. We will delete your account, all community reports tied to it, and any hashed IPs we can correlate, within 30 days. You will receive a confirmation when this is done.

## Cookies

A single session cookie for login. No analytics, advertising, or tracking cookies.

## Contact

Privacy questions: **contact@islagrid.app**.
