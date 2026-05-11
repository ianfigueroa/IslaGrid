import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Public API — IslaGrid",
  description:
    "Free, read-only, source-labeled API for Puerto Rico grid intelligence. Researcher keys, rate limits, and OpenAPI spec.",
};

const SWAGGER_VERSION = "5.21.0";

export default function ApiDocsPage() {
  return (
    <main className="min-h-dvh bg-bg text-text">
      <header className="border-b border-line px-6 py-6">
        <div className="mx-auto max-w-5xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-3">
            Public API
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
            IslaGrid Public API
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-text-2">
            Read-only, source-labeled, free for research and journalism. Anonymous
            requests get 60 req/min and 1,000 req/day per IP. For higher limits,
            email{" "}
            <a href="mailto:iantdm11@gmail.com" className="underline-offset-2 hover:underline">
              iantdm11@gmail.com
            </a>{" "}
            with a one-paragraph description of your use case.
          </p>

          <section id="rate-limits" className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="surface rounded-md p-4 text-sm">
              <p className="text-[11px] font-mono uppercase tracking-wider text-text-3">
                Anonymous tier
              </p>
              <p className="mt-1 font-mono text-text">
                60 req/min · 1,000 req/day per IP
              </p>
              <p className="mt-2 text-xs text-text-2">
                Headers <code>x-ratelimit-*</code> tell you where you stand on
                each window.
              </p>
            </div>
            <div className="surface rounded-md p-4 text-sm">
              <p className="text-[11px] font-mono uppercase tracking-wider text-text-3">
                Researcher tier (with key)
              </p>
              <p className="mt-1 font-mono text-text">
                Default 600 req/min · 100k req/day per key
              </p>
              <p className="mt-2 text-xs text-text-2" id="auth">
                Send via <code>Authorization: Bearer ig_…</code> or{" "}
                <code>X-IslaGrid-API-Key</code> header.
              </p>
            </div>
          </section>

          <p className="mt-6 text-xs text-text-3">
            Privacy floor: community-report aggregates are suppressed when an H3
            cell has fewer than 5 reports (k-anonymity, k=5). Exact lat/lon is
            never exposed. Read the{" "}
            <a href="/privacy" className="underline-offset-2 hover:underline">
              privacy policy
            </a>{" "}
            for the full data-handling rules.
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-8">
        <div id="swagger-ui" />
      </section>

      {/* Swagger UI loaded from CDN to avoid an npm dep — the spec is local. */}
      <link
        rel="stylesheet"
        href={`https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`}
      />
      <script
        src={`https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`}
        defer
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
            window.addEventListener('load', function () {
              if (!window.SwaggerUIBundle) return;
              window.SwaggerUIBundle({
                url: '/api/public/openapi.json',
                dom_id: '#swagger-ui',
                docExpansion: 'list',
                deepLinking: true,
                tryItOutEnabled: true,
              });
            });
          `,
        }}
      />
    </main>
  );
}
