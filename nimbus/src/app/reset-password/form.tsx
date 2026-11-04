"use client";
import { useActionState } from "react";
import { resetPassword } from "@/lib/actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="token" value={token} />
      <label className="block text-sm">New password<input name="password" type="password" required minLength={8} autoComplete="new-password" className="mt-1 h-10 w-full rounded-md border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent" /></label>
      {state?.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button disabled={pending} className="h-10 w-full rounded-md bg-fg text-sm font-medium text-bg disabled:opacity-50">{pending ? "Saving..." : "Set new password"}</button>
    </form>
  );
}
