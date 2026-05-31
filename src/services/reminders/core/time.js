import { addMinutes, isWithinInterval, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export function toDate(value) {
  return value instanceof Date ? value : parseISO(value);
}

export function formatHour(value, timezone) {
  return formatInTimeZone(toDate(value), timezone, "hh:mm a");
}

export function formatDateLabel(value, timezone) {
  return formatInTimeZone(toDate(value), timezone, "dd/MM/yyyy");
}

export function isTodayAtHour(value, timezone, hour) {
  const dateLabel = formatInTimeZone(toDate(value), timezone, "yyyy-MM-dd");
  const nowLabel = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const currentHour = Number(formatInTimeZone(new Date(), timezone, "H"));

  return dateLabel === nowLabel && currentHour >= hour;
}

export function isWithinLeadWindow(value, leadMinutes, windowMinutes) {
  const start = addMinutes(new Date(), leadMinutes);
  const end = addMinutes(start, windowMinutes);
  return isWithinInterval(toDate(value), { start, end });
}
