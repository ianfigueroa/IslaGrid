import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocsLayout } from "../(docs)/_components/DocsLayout";
import { readDoc } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Attribution · IslaGrid AI",
  description: "Public data sources behind IslaGrid AI.",
};

export default async function AttributionPage() {
  const md = await readDoc("ATTRIBUTION.md");
  return (
    <DocsLayout>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </DocsLayout>
  );
}
