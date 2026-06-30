import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocsLayout } from "../(docs)/_components/DocsLayout";
import { readDoc } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Privacy · IslaGrid",
  description: "Privacy policy for IslaGrid.",
};

export default async function PrivacyPage() {
  const md = await readDoc("PRIVACY_POLICY.md");
  return (
    <DocsLayout>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </DocsLayout>
  );
}
