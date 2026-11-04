"use client";
import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/lib/actions";

export function AuthForm({ mode, action, next }: { mode: "login" | "signup"; action: (s: FormState, f: FormData) => Promise<FormState>; next?: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const input = "h-10 w-full rounded-md border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent";
  return (
    <div className="mx-auto max-w-sm px-4 py-20">
      <h1 className="text-3xl font-bold tracking-tight">{mode === "login" ? "Log in" : "Create your account"}</h1>
      <form action={formAction} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        {mode === "signup" && (
          <label className="block text-sm">Name<input name="name" required autoComplete="name" className={`${input} mt-1`} /></label>
        )}
        <label className="block text-sm">Email<input name="email" type="email" required autoComplete="email" className={`${input} mt-1`} /></label>
        <label className="block text-sm">Password<input name="password" type="password" required minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} className={`${input} mt-1`} /></label>
        {mode === "login" && <p className="-mt-2 text-right text-xs"><Link href="/forgot-password" className="text-muted underline hover:text-fg">Forgot password?</Link></p>}
        {state?.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        <button disabled={pending} className="h-10 w-full rounded-md bg-fg text-sm font-medium text-bg disabled:opacity-50">
          {pending ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {mode === "login" ? <>No account? <Link className="underline" href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign up</Link></> : <>Have an account? <Link className="underline" href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Log in</Link></>}
      </p>
    </div>
  );
}
