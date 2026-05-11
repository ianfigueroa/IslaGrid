import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocsLayout } from "../(docs)/_components/DocsLayout";
import { readDoc } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Terms · IslaGrid AI",
  description: "Terms of service for IslaGrid AI.",
};

export default async function TermsPage() {
  const md = await readDoc("TERMS_OF_SERVICE.md");
  return (
    <DocsLayout>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </DocsLayout>
  );
}
