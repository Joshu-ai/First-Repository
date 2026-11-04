import Link from "next/link";
import { ResetForm } from "./form";
export const metadata = { title: "Reset password" };
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-sm px-4 py-20">
      <h1 className="text-3xl font-bold tracking-tight">Choose a new password</h1>
      {token ? <ResetForm token={token} /> : <p className="mt-6 text-muted">This link is missing its token. <Link href="/forgot-password" className="underline">Request a new one</Link>.</p>}
    </div>
  );
}
