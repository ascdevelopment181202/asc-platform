import { toGsm } from "@/lib/sms-text";

// Ready-made reactivation messages. Shared by the server and the message editor in the browser.
// {name} = first name, {sender} = "Paul from P.I.C Driveways", {business} = business name.

// Each fits one 160-character text (one charge) with the opt-out line and a typical name like "Paul from P.I.C Driveways".
export const CAMPAIGN_PRESETS: { key: string; name: string; body: string }[] = [
  { key: "miss-you", name: "We miss you (10% off)", body: "Hi {name}, it's {sender}. It's been a while! Need anything doing? Reply here for 10% off until the end of the month." },
  { key: "spare-slots", name: "Spare slots this week", body: "Hi {name}, it's {sender}. We've got spare slots next week. Reply here to book, with 10% off for past customers." },
  { key: "seasonal", name: "Seasonal check-up", body: "Hi {name}, it's {sender}. Winter's coming, a good time for a check-up. 15% off this month, reply YES to book." },
  { key: "refer", name: "Refer a friend", body: "Hi {name}, it's {sender}. Know anyone who needs a hand? Send them our way and you'll both get 10% off." },
  { key: "annual", name: "Annual service reminder", body: "Hi {name}, it's {sender}. It's been about a year since our visit. Reply YES to book your service, with \u00a320 off." },
];

export const OPT_OUT = "Reply STOP to opt out";

/** Fills a campaign message for one customer and makes sure the opt-out line is on the end. */
export function fillCampaign(body: string, vars: { name: string | null; sender: string; business: string }) {
  const first = vars.name?.trim().split(/\s+/)[0];
  let text = body
    .replace(/\{name\}/g, first || "there")
    .replace(/\{sender\}/g, vars.sender)
    .replace(/\{business\}/g, vars.business)
    .replace(/\s+/g, " ")
    .trim();
  if (!/reply stop/i.test(text)) text = `${text} ${OPT_OUT}`;
  return toGsm(text);
}

export { segmentsOf as segments } from "@/lib/sms-text";
