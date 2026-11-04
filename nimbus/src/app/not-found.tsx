import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-32 text-center">
      <h1 className="text-6xl font-bold">404</h1>
      <p className="mt-4 text-muted">This page could not be found.</p>
      <Link href="/" className="mt-8 inline-block text-sm underline">Go home</Link>
    </div>
  );
}
