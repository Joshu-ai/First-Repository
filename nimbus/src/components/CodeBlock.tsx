"use client";
import { useState } from "react";

export function CodeBlock({ source, file, lang }: { source: string; file?: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-line bg-bg-soft">
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
        <span className="font-mono">{file ?? lang}</span>
        <button
          aria-label="Copy code"
          onClick={async () => { await navigator.clipboard.writeText(source); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="rounded px-2 py-0.5 hover:bg-bg hover:text-fg"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-6"><code className="font-mono">{source}</code></pre>
    </div>
  );
}
