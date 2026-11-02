import Link from "next/link";
import { site } from "@/content";

// Thin strip above each concept project so visitors know where they are.
export function DemoBar({ name }: { name: string }) {
  return (
    <div className="demo-bar">
      <span>
        {name} is a concept project by {site.name}.
      </span>
      <Link href="/#work">Back to {site.name}</Link>
    </div>
  );
}
