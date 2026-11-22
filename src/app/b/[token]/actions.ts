"use server";

import { messageCustomer, validEmail } from "@/lib/customer-email";
import { firstThatFits } from "@/lib/sms-text";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { isTextable, normalizePhone } from "@/lib/phone";
import { bumpConversation, countryOf, sendSms, upsertContact } from "@/lib/sms";
import { freeSlots, setStage, whenLabel, zonedToUtc } from "@/lib/crm";
import { notifyClient } from "@/lib/push";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** A customer booking themselves from the public link. */
export async function bookSlot(f: FormData) {
  const token = str(f, "token");
  if (!/^[0-9a-f]{16}$/.test(token)) throw new Error("Invalid link");
  const { data: c } = await db().from("clients").select("*").eq("booking_token", token).maybeSingle<Client>();
  if (!c || !c.booking_enabled) throw new Error("Booking isn't available");
  const day = str(f, "day");
  const time = str(f, "time");
  const page = `/b/${token}?day=${day}&time=${time}`;
  if (str(f, "website")) redirect(`/b/${token}?done=1`); // bots fill the hidden field

  const country = countryOf(c);
  const phone = normalizePhone(str(f, "phone"), country);
  if (!phone || !isTextable(phone, country)) redirect(`${page}&err=${encodeURIComponent(country === "US" ? "Enter a valid cell number." : "Enter a valid mobile number.")}`);
  const name = str(f, "name");
  if (!name) redirect(`${page}&err=${encodeURIComponent("Enter your name.")}`);

  // Check the slot is still free right before saving.
  if (!(await freeSlots(c, day)).includes(time)) redirect(`/b/${token}?day=${day}&err=${encodeURIComponent("Sorry, that time was just taken. Please pick another.")}`);

  const contact = await upsertContact(c.id, phone, name);
  const address = str(f, "address");
  const what = str(f, "what");
  if (address && !contact.address) await db().from("contacts").update({ address }).eq("id", contact.id);
  const email = str(f, "email").slice(0, 200);
  if (validEmail(email) && !contact.email) {
    await db().from("contacts").update({ email }).eq("id", contact.id);
    contact.email = email;
  }
  const starts = zonedToUtc(day, time, c.timezone || "Europe/London");
  const ends = new Date(starts.getTime() + (c.booking_slot_minutes || 60) * 60_000);
  await db().from("appointments").insert({
    client_id: c.id,
    contact_id: contact.id,
    title: (what ? what.split("\n")[0] : `Booking: ${name}`).slice(0, 120),
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    address: address || null,
    notes: what || null,
    source: "booking",
  });
  await setStage(contact, "booked");
  const when = whenLabel(c, starts.toISOString());
  await bumpConversation(contact.id, `Booked online for ${when}`, "inbound", true);

  after(async () => {
    await notifyClient(c.id, { title: `New booking: ${name}`, body: `${when}${what ? ` · ${what.slice(0, 80)}` : ""}`, url: `/m/${c.dashboard_token}/c/${contact.id}`, tag: contact.id });
    await messageCustomer({
      client: c,
      contact,
      text: firstThatFits([`Hi ${name.split(/\s+/)[0]}, you're booked in with ${clientLabel(c)} on ${when}. Reply to this text if you need to change it.`, `You're booked with ${clientLabel(c)}: ${when}. Reply to change it.`]),
      email: { subject: `You're booked in with ${clientLabel(c)}`, paragraphs: [`Hi ${name.split(/\s+/)[0]},`, `Thanks for booking. You're booked in for ${when}.`, "Just reply to this email if you need to change anything."] },
    });
  });
  redirect(`/b/${token}?done=1&when=${encodeURIComponent(when)}`);
}
