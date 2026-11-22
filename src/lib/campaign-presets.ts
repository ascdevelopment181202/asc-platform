// Ready-made reactivation messages. Shared by the server and the message editor in the browser.
// {name} = first name, {sender} = "Paul from P.I.C Driveways", {business} = business name.

export const CAMPAIGN_PRESETS: { key: string; name: string; body: string }[] = [
  {
    key: "miss-you",
    name: "We miss you (10% off)",
    body: "Hi {name}, it's {sender}. It's been a while! If there's anything you need doing, reply to this text and we'll sort it. 10% off for returning customers until the end of the month.",
  },
  {
    key: "spare-slots",
    name: "Spare slots this week",
    body: "Hi {name}, it's {sender}. A couple of slots have opened up next week. If there's a job you've been putting off, reply here and we'll fit you in, with 10% off for past customers.",
  },
  {
    key: "seasonal",
    name: "Seasonal check-up",
    body: "Hi {name}, it's {sender}. With the weather turning, now's a good time for a check-up before anything goes wrong. Past customers get 15% off this month. Reply YES and we'll get you booked in.",
  },
  {
    key: "refer",
    name: "Refer a friend",
    body: "Hi {name}, it's {sender}. Thanks again for choosing us. If you know anyone who needs a hand, pass on our number and you'll both get 10% off your next job.",
  },
  {
    key: "annual",
    name: "Annual service reminder",
    body: "Hi {name}, it's {sender}. It's about a year since we last came out, so you might be due a service. Reply YES and we'll find a time that suits, with £20 off for returning customers.",
  },
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
  return text;
}

/** SMS segments: 160 characters (153 per part when longer), 70 if it has emoji or other special characters. */
export function segments(text: string) {
  const gsm = /^[\x20-\x7E£€\n\r]*$/.test(text);
  const one = gsm ? 160 : 70;
  const many = gsm ? 153 : 67;
  return text.length <= one ? 1 : Math.ceil(text.length / many);
}
