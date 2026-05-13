import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadScorecard } from "@/lib/scorecards";
import { SubPageHeader } from "@/app/_components/SubPageHeader";
import { MunicipalityScorecard } from "./MunicipalityScorecard";

export const dynamic = "force-dynamic";
export const revalidate = 300;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await loadScorecard(id);
  if (!data) {
    return { title: "Municipality not found — IslaGrid" };
  }
  const name = data.basics.name;
  return {
    title: `${name} grid scorecard — IslaGrid`,
    description: `Live grid status, outage risk, planned work, and recent outage events for ${name}, Puerto Rico. Source-labeled, never fabricated.`,
    openGraph: {
      title: `${name} grid scorecard`,
      description: `Live grid intelligence for ${name}, Puerto Rico.`,
      type: "article",
    },
  };
}

export default async function MunicipalityPage({ params }: Props) {
  const { id } = await params;
  const data = await loadScorecard(id);
  if (!data) notFound();

  return (
    <div className="min-h-dvh bg-bg text-text">
      <SubPageHeader title={`${data.basics.name} scorecard`} />
      <main className="px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <p className="mb-3 text-[11px]">
            <a
              href="/m"
              className="text-text-3 underline-offset-2 hover:text-text-2 hover:underline"
            >
              ← All municipalities
            </a>
          </p>
          <MunicipalityScorecard data={data} />
        </div>
      </main>
    </div>
  );
}
