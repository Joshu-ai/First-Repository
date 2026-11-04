"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestReset } from "@/lib/actions";

export default function Forgot() {
  const [state, action, pending] = useActionState(requestReset, undefined);
  return (
    <div className="mx-auto max-w-sm px-4 py-20">
      <h1 className="text-3xl font-bold tracking-tight">Forgot your password?</h1>
      {state?.sent ? (
        <p role="status" className="mt-6 text-muted">If an account exists for that email, we&apos;ve sent a reset link. Check your inbox (and spam folder).</p>
      ) : (
        <form action={action} className="mt-8 space-y-4">
          <p className="text-sm text-muted">Enter your email and we&apos;ll send you a link to choose a new password.</p>
          <label className="block text-sm">Email<input name="email" type="email" required autoComplete="email" className="mt-1 h-10 w-full rounded-md border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent" /></label>
          <button disabled={pending} className="h-10 w-full rounded-md bg-fg text-sm font-medium text-bg disabled:opacity-50">{pending ? "Sending..." : "Send reset link"}</button>
        </form>
      )}
      <p className="mt-6 text-sm text-muted"><Link href="/login" className="underline">Back to log in</Link></p>
    </div>
  );
}
