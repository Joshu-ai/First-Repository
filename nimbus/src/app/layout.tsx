import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SearchProvider } from "@/components/CommandPalette";
import { themeInitScript } from "@/components/ThemeToggle";
import { currentUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import Link from "next/link";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: `${brand.name}: templates, websites, courses and hosting`, template: `%s | ${brand.name}` },
  description: "Production-ready templates and starter kits.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  const account = user ? (
    <Link href="/dashboard" className="flex h-8 items-center rounded-md bg-fg px-3 text-sm font-medium text-bg hover:opacity-90">Dashboard</Link>
  ) : (
    <>
      <Link href="/login" className="hidden text-sm text-muted hover:text-fg sm:block">Log in</Link>
      <Link href="/signup" className="flex h-8 items-center rounded-md bg-fg px-3 text-sm font-medium text-bg hover:opacity-90">Sign up</Link>
    </>
  );
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SearchProvider>
          <Header account={account} />
          <main className="min-h-[70vh]">{children}</main>
          <Footer />
        </SearchProvider>
      </body>
    </html>
  );
}
