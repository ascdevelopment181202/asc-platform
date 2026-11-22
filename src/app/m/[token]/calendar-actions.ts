"use server";

import { cancelBookingReview } from "@/lib/review-autopilot";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { isTextable, normalizePhone } from "@/lib/phone";
import { countryOf, createJob, sendSms, upsertContact, type Contact, firstSendLabel } from "@/lib/sms";
import { setStage, whenLabel, zonedToUtc, type Appointment } from "@/lib/crm";
import { clientFromForm, loadContact } from "./data";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, type: "ok" | "err", msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${type}=${encodeURIComponent(msg)}`);
const firstName = (n: string | null) => n?.split(/\s+/)[0] || "there";

export async function createAppointment(f: FormData) {
  const c = await clientFromForm(f);
  const page = `/m/${c.dashboard_token}/calendar/new`;
  const country = countryOf(c);
  const tz = c.timezone || "Europe/London";

  let contact: Contact | null = null;
  if (str(f, "contactId")) contact = await loadContact(c.id, str(f, "contactId"));
  else if (str(f, "phone")) {
    const phone = normalizePhone(str(f, "phone"), country);
    if (!phone || !isTextable(phone, country)) return back(page, "err", "Enter a valid mobile number, or leave it blank.");
    contact = await upsertContact(c.id, phone, str(f, "name") || null);
  }

  const date = str(f, "date");
  const time = str(f, "time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return back(page, "err", "Pick a date and time.");
  const minutes = Math.min(Math.max(Number(str(f, "duration")) || 60, 15), 12 * 60);
  const starts = zonedToUtc(date, time, tz);
  const ends = new Date(starts.getTime() + minutes * 60_000);
  const title = str(f, "title") || (contact?.name ? `Job: ${contact.name}` : "Job");

  const { data: appt, error } = await db()
    .from("appointments")
    .insert({
      client_id: c.id,
      contact_id: contact?.id ?? null,
      title: title.slice(0, 120),
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      address: str(f, "address") || contact?.address || null,
      notes: str(f, "notes") || null,
      source: "app",
      // No confirmation text means no reminder text either.
      reminder_sent_at: f.get("confirm") === "on" && contact ? null : new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !appt) return back(page, "err", "Couldn't save the booking. Try again.");

  if (contact) {
    await setStage(contact, "booked");
    if (f.get("confirm") === "on" && !contact.opted_out_at) {
      await sendSms({
        client: c,
        to: contact.phone,
        kind: "manual",
        contactId: contact.id,
        body: `Hi ${firstName(contact.name)}, you're booked in with ${clientLabel(c)} on ${whenLabel(c, starts.toISOString())}. Reply to this text if you need to change it.`,
      });
    }
  }
  redirect(`/m/${c.dashboard_token}/calendar/${appt.id}`);
}

async function apptFromForm(f: FormData) {
  const c = await clientFromForm(f);
  const { data: appt } = await db().from("appointments").select("*").eq("id", str(f, "id")).eq("client_id", c.id).maybeSingle<Appointment>();
  if (!appt) throw new Error("Booking not found");
  const contact = appt.contact_id ? await loadContact(c.id, appt.contact_id) : null;
  return { c, appt, contact, page: `/m/${c.dashboard_token}/calendar/${appt.id}` };
}

export async function updateAppointment(f: FormData) {
  const { c, appt, contact, page } = await apptFromForm(f);
  const tz = c.timezone || "Europe/London";
  const date = str(f, "date");
  const time = str(f, "time");
  const minutes = Math.min(Math.max(Number(str(f, "duration")) || 60, 15), 12 * 60);
  const starts = zonedToUtc(date, time, tz);
  const moved = starts.toISOString() !== new Date(appt.starts_at).toISOString();
  await db()
    .from("appointments")
    .update({
      title: (str(f, "title") || appt.title).slice(0, 120),
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + minutes * 60_000).toISOString(),
      address: str(f, "address") || null,
      notes: str(f, "notes") || null,
      ...(moved ? { reminder_sent_at: null } : {}),
    })
    .eq("id", appt.id);
  if (moved && contact && f.get("notify") === "on" && !contact.opted_out_at) {
    await sendSms({ client: c, to: contact.phone, kind: "manual", contactId: contact.id, body: `Hi ${firstName(contact.name)}, your booking with ${clientLabel(c)} has moved to ${whenLabel(c, starts.toISOString())}. Reply if that doesn't work.` });
  }
  back(page, "ok", "Booking updated.");
}

export async function markAppointmentDone(f: FormData) {
  const { c, appt, contact, page } = await apptFromForm(f);
  await db().from("appointments").update({ status: "done", review_queued_at: new Date().toISOString() }).eq("id", appt.id);
  if (contact && f.get("review") === "on") {
    const result = await createJob(c, { phone: contact.phone, name: contact.name, source: "dashboard", label: appt.title, appointmentId: appt.id });
    if (!result.ok) back(page, "err", `Marked as done. Review request not sent: ${result.error}`);
    back(page, "ok", `Marked as done. Review request goes out ${firstSendLabel(c)}.`);
  }
  if (contact) await setStage(contact, "done");
  back(page, "ok", "Marked as done.");
}

export async function cancelAppointment(f: FormData) {
  const { c, appt, contact, page } = await apptFromForm(f);
  await db().from("appointments").update({ status: "cancelled" }).eq("id", appt.id);
  await cancelBookingReview(appt.id);
  if (contact && f.get("notify") === "on" && !contact.opted_out_at) {
    await sendSms({ client: c, to: contact.phone, kind: "manual", contactId: contact.id, body: `Hi ${firstName(contact.name)}, your booking with ${clientLabel(c)} on ${whenLabel(c, appt.starts_at)} has been cancelled. Reply to rearrange.` });
  }
  back(page, "ok", "Booking cancelled.");
}
