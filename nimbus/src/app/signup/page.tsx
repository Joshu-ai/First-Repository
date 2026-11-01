import { AuthForm } from "@/components/AuthForm";
import { signup } from "@/lib/actions";
export const metadata = { title: "Sign up" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthForm mode="signup" action={signup} next={(await searchParams).next} />;
}
