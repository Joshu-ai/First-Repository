import { AuthForm } from "@/components/AuthForm";
import { login } from "@/lib/actions";
export const metadata = { title: "Log in" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthForm mode="login" action={login} next={(await searchParams).next} />;
}
