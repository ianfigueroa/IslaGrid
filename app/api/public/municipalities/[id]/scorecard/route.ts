import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/public-api";
import { loadScorecard } from "@/lib/scorecards";

export const dynamic = "force-dynamic";

export const GET = publicHandler(
  { route: "/api/public/municipalities/[id]/scorecard" },
  async (req) => {
    // Parse the muni id from the URL path; Next App Router params aren't
    // available in this wrapper, so derive from URL.
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    // Path: api/public/municipalities/<id>/scorecard
    const id = parts[3];
    if (!id) {
      return NextResponse.json(
        { error: "Missing municipality id." },
        { status: 400 },
      );
    }
    const data = await loadScorecard(id);
    if (!data) {
      return NextResponse.json(
        { error: "Municipality not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(data);
  },
);
