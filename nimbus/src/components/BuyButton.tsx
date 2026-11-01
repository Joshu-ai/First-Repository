import { buy } from "@/lib/store-actions";

export function BuyButton({ slug, label, className = "" }: { slug: string; label: string; className?: string }) {
  return (
    <form action={buy}>
      <input type="hidden" name="slug" value={slug} />
      <button className={`h-11 w-full rounded-md font-medium ${className || "bg-fg text-bg hover:opacity-90"}`}>{label}</button>
    </form>
  );
}
