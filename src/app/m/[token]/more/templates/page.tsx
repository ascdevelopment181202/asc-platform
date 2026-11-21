import { notFound } from "next/navigation";
import { snippetsFor } from "@/lib/crm";
import { loadClient } from "../../data";
import { Card, field, primaryBtn, SubHeader } from "../../ui";
import { addSnippet, deleteSnippet } from "../../crm-actions";

export const dynamic = "force-dynamic";

export default async function Templates({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await loadClient(token);
  if (!c) notFound();
  const snippets = await snippetsFor(c.id);
  return (
    <>
      <SubHeader back={`/m/${token}/more`} title="Saved replies" />
      <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
        <p className="text-sm text-neutral-600">
          Tap ⚡ Templates in any conversation to drop one in. Use <code>{"{name}"}</code> for the customer&apos;s first name and <code>{"{booking}"}</code> for your booking link.
        </p>
        <ul className="space-y-2">
          {snippets.map((s) => (
            <li key={s.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{s.title}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-600">{s.body}</p>
                </div>
                <form action={deleteSnippet}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="id" value={s.id} />
                  <button className="text-sm text-red-600">Delete</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
        <Card title="Add a saved reply">
          <form action={addSnippet} className="space-y-2">
            <input type="hidden" name="token" value={token} />
            <input name="title" required placeholder="Name (e.g. Quote follow-up)" className={field} />
            <textarea name="body" required rows={3} placeholder="Hi {name}, just checking you got the quote..." className={field} />
            <button className={primaryBtn}>Save</button>
          </form>
        </Card>
      </main>
    </>
  );
}
