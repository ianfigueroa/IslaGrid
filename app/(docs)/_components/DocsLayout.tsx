import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

const NAV = [
  { href: "/attribution", label: "Attribution" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

export function DocsLayout({ children }: Props) {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="surface sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-md">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to map
        </Link>
        <div className="ml-2 flex items-center gap-2 border-l border-line pl-4">
          <Zap className="size-4 text-brand" aria-hidden />
          <span className="font-mono text-sm">
            IslaGrid<span className="text-text-3">/PR</span>
          </span>
        </div>
        <nav className="ml-auto flex gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-3xl px-6 py-12">
        <article className="prose-islagrid">{children}</article>
      </div>
    </div>
  );
}
