import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">ASC Platform</h1>
        <p className="mt-2 text-neutral-600">Client onboarding and delivery.</p>
        <Link href="/admin" className="mt-6 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          Open admin
        </Link>
      </div>
    </main>
  );
}
