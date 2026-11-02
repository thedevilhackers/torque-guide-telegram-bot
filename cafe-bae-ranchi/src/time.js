// Ranchi runs on India Standard Time (UTC+05:30, no daylight saving), so all
// opening-hours and booking maths happens in IST regardless of server timezone.
const IST_OFFSET_MINUTES = 330;
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (value) => String(value).padStart(2, "0");

export function istParts(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    iso: `${year}-${pad(month)}-${pad(day)}`,
    dow: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}

export function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function addDays(iso, days) {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((parseIsoDate(toIso) - parseIsoDate(fromIso)) / 86_400_000);
}

export function toMinutes(hhmm) {
  if (typeof hhmm !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function toHHMM(minutes) {
  const normalised = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalised / 60))}:${pad(normalised % 60)}`;
}

export function formatTime(minutes) {
  const normalised = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalised / 60);
  const mins = normalised % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${pad(mins)} ${suffix}`;
}

/** Returns [openMinutes, closeMinutes] for a day, or null if closed. Close may exceed 1440 for late nights. */
export function dayWindow(hours, dow) {
  const entry = hours?.[DAY_KEYS[dow]];
  if (!Array.isArray(entry) || entry.length !== 2) return null;
  const open = toMinutes(entry[0]);
  let close = toMinutes(entry[1]);
  if (open === null || close === null) return null;
  if (close <= open) close += 1440;
  return [open, close];
}

export function openStatus(hours, now = new Date()) {
  const today = istParts(now);
  const yesterdayWindow = dayWindow(hours, (today.dow + 6) % 7);
  if (yesterdayWindow && yesterdayWindow[1] > 1440 && today.minutes < yesterdayWindow[1] - 1440) {
    const close = yesterdayWindow[1] - 1440;
    return { open: true, closingSoon: close - today.minutes <= 45, label: `Open now · until ${formatTime(close)}` };
  }

  const window = dayWindow(hours, today.dow);
  if (window) {
    const [open, close] = window;
    if (today.minutes >= open && today.minutes < close) {
      return { open: true, closingSoon: close - today.minutes <= 45, label: `Open now · until ${formatTime(close)}` };
    }
    if (today.minutes < open) return { open: false, closingSoon: false, label: `Opens today at ${formatTime(open)}` };
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const dow = (today.dow + offset) % 7;
    const next = dayWindow(hours, dow);
    if (next) {
      const when = offset === 1 ? "tomorrow" : DAY_NAMES[dow];
      return { open: false, closingSoon: false, label: `Closed · opens ${when} at ${formatTime(next[0])}` };
    }
  }
  return { open: false, closingSoon: false, label: "Temporarily closed" };
}

export function hoursTable(hours, now = new Date()) {
  const { dow: todayDow } = istParts(now);
  // Monday-first, the way most Indian menus print it.
  return [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const window = dayWindow(hours, dow);
    return {
      day: DAY_NAMES[dow],
      today: dow === todayDow,
      label: window ? `${formatTime(window[0])} – ${formatTime(window[1])}` : "Closed"
    };
  });
}

/** Reservation start times for a date (IST). Past times today are removed. */
export function reservationSlots(hours, isoDate, settings, now = new Date()) {
  const date = parseIsoDate(isoDate);
  if (!date) return [];
  const window = dayWindow(hours, date.getUTCDay());
  if (!window) return [];
  const step = Math.max(15, Number(settings?.slotMinutes) || 30);
  const lastSeating = window[1] - Math.max(0, Number(settings?.lastSeatingBeforeCloseMinutes) || 60);
  const today = istParts(now);
  const earliest = isoDate === today.iso ? today.minutes + 30 : -Infinity;
  const slots = [];
  for (let minutes = window[0]; minutes <= lastSeating; minutes += step) {
    if (minutes >= earliest) slots.push({ time: toHHMM(minutes), label: formatTime(minutes), minutes });
  }
  return slots;
}
