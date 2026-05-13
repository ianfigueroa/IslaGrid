import { NextResponse } from "next/server";

export const dynamic = "force-static";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "IslaGrid Public API",
    version: "0.1.0",
    description:
      "Public, source-labeled, read-only data about Puerto Rico's electric grid. " +
      "Free for research and journalism. See /docs/api for rate limits, key " +
      "requests, and the privacy policy. Every field is sourced from a real " +
      "ingested record or labeled as a heuristic estimate — IslaGrid does not " +
      "fabricate data.",
    contact: { email: "contact@islagrid.app" },
    license: {
      name: "Data attribution applies — see /attribution",
      url: "/attribution",
    },
  },
  servers: [
    {
      url: "https://islagrid.example/api/public",
      description: "Production",
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "ig_<prefix>_<secret>",
        description:
          "Researcher keys are free. Mint one by emailing the contact above. " +
          "Anonymous requests work at a tighter rate limit (60/min, 1000/day).",
      },
    },
    schemas: {
      GridSnapshot: {
        type: "object",
        properties: {
          ts: { type: "string", format: "date-time" },
          current_demand_mw: { type: "number", nullable: true },
          next_hour_demand_mw: { type: "number", nullable: true },
          total_generation_mw: { type: "number", nullable: true },
          available_capacity_mw: { type: "number", nullable: true },
          operational_reserve_mw: { type: "number", nullable: true },
          status: { type: "string", enum: ["normal", "watch", "strained", "critical", "stale", "unknown"] },
          source: { type: "string" },
          source_stale: { type: "boolean" },
        },
      },
      RiskRow: {
        type: "object",
        properties: {
          municipality_id: { type: "string" },
          ts: { type: "string", format: "date-time" },
          risk_score: { type: "number", minimum: 0, maximum: 100 },
          band: { type: "string", enum: ["low", "elevated", "high", "severe", "unknown"] },
          reasons: { type: "array", items: { type: "string" } },
        },
      },
      PlannedWorkRow: {
        type: "object",
        properties: {
          id: { type: "string" },
          municipality_id: { type: "string", nullable: true },
          area: { type: "string", nullable: true },
          work_type: { type: "string", nullable: true },
          start_ts: { type: "string", format: "date-time", nullable: true },
          end_ts: { type: "string", format: "date-time", nullable: true },
          possible_interruption: { type: "boolean", nullable: true },
          source_url: { type: "string", nullable: true },
        },
      },
      ReportFeatureCollection: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["FeatureCollection"] },
          k_anonymity_threshold: { type: "integer" },
          features: { type: "array", items: { type: "object" } },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          retry_after_seconds: { type: "integer", nullable: true },
          docs: { type: "string", nullable: true },
        },
      },
    },
  },
  paths: {
    "/grid-status": {
      get: {
        summary: "Latest island-wide grid snapshot",
        description:
          "Most recent row from `grid_snapshots`. Sourced from LUMA System Overview ingest. Returns `null` snapshot with a `reason` when no fresh data is available.",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    snapshot: { $ref: "#/components/schemas/GridSnapshot" },
                    reason: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/generation/current": {
      get: {
        summary: "Per-plant generation in the last hour",
        responses: { "200": { description: "OK" } },
      },
    },
    "/reserves/current": {
      get: {
        summary: "Latest island-wide reserves",
        responses: { "200": { description: "OK" } },
      },
    },
    "/outage-risk": {
      get: {
        summary: "Per-municipality heuristic outage-risk band",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/RiskRow" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/planned-work": {
      get: {
        summary: "Currently-active LUMA planned-work items",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/PlannedWorkRow" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/municipalities/{id}/scorecard": {
      get: {
        summary: "Full scorecard for one municipality",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Municipality id (matches the geojson `id` / FIPS).",
          },
        ],
        responses: {
          "200": { description: "OK" },
          "404": { description: "Not found" },
        },
      },
    },
    "/community-reports/aggregate": {
      get: {
        summary: "H3-aggregated community reports (k-anonymized)",
        description:
          "Hex cells with fewer than 5 reports are suppressed entirely (k-anonymity, k=5). Exact lat/lon is never returned. Cells are H3 res-7.",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReportFeatureCollection" },
              },
            },
          },
        },
      },
    },
  },
  security: [{ ApiKeyAuth: [] }, {}],
} as const;

export async function GET() {
  return NextResponse.json(spec);
}
