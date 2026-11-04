"use client";
import { useActionState } from "react";
import { submitBrief } from "@/lib/project-actions";

const fields: [string, string, boolean, string][] = [
  ["business", "Business name", true, "input"],
  ["about", "What does your business do?", true, "textarea"],
  ["audience", "Who are your customers?", false, "textarea"],
  ["pages", "Which pages do you need?", false, "textarea"],
  ["style", "Brand colors, fonts or style words", false, "textarea"],
  ["examples", "Websites you like (links)", false, "textarea"],
  ["domain", "Your domain (if you have one)", false, "input"],
  ["deadline", "Any deadline?", false, "input"],
];

export function BriefForm({ projectId }: { projectId: number }) {
  const [state, action, pending] = useActionState(submitBrief, undefined);
  const c = "mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      {fields.map(([n, l, req, t]) => (
        <label key={n} className="block text-sm">{l}{req && " *"}
          {t === "input" ? <input name={n} required={req} className={c} /> : <textarea name={n} rows={3} required={req} className={c} />}
        </label>
      ))}
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button disabled={pending} className="h-10 rounded-md bg-fg px-5 text-sm font-medium text-bg disabled:opacity-50">{pending ? "Sending..." : "Submit brief"}</button>
    </form>
  );
}
