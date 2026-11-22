import { notFound } from "next/navigation";
import { openTasks } from "@/lib/tasks";
import { loadClient, unreadTotal } from "../data";
import { AppShell, Card, Flash } from "../ui";
import { AddTaskForm, TaskList } from "../tasks-ui";

export const dynamic = "force-dynamic";

/** Follow-ups: what's due today or overdue first, then everything coming up. */
export default async function Tasks({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const tz = c.timezone || "Europe/London";
  const [tasks, unread] = await Promise.all([openTasks(c.id, { limit: 200 }), unreadTotal(c.id)]);
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const now = tasks.filter((t) => new Date(t.due_at).toLocaleDateString("en-CA", { timeZone: tz }) <= todayKey);
  const later = tasks.filter((t) => !now.includes(t));
  const back = `/m/${token}/tasks`;

  return (
    <AppShell token={token} active="more" unread={unread} title="Tasks">
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4 p-4">
        <Card title={`Today${now.length ? ` (${now.length})` : ""}`}>
          <TaskList token={token} tasks={now} tz={tz} country={c.country} back={back} />
        </Card>
        {later.length > 0 && (
          <Card title="Coming up">
            <TaskList token={token} tasks={later} tz={tz} country={c.country} back={back} />
          </Card>
        )}
        <Card title="Add a task">
          <AddTaskForm token={token} back={back} />
          <p className="mt-2 text-xs text-neutral-500">We&apos;ll send a notification to your phone when it&apos;s due. To tie a task to a customer, add it from their page.</p>
        </Card>
      </div>
    </AppShell>
  );
}
