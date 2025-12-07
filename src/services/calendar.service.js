import dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import {
  addDays,
  addMinutes,
  isBefore,
  isAfter,
  max as maxDate,
  parseISO,
  setHours,
  setMinutes,
  startOfDay,
  isValid,
  getDay,
  format
} from "date-fns";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const TIMEZONE = process.env.CALENDAR_TIMEZONE?.trim() || "America/Lima";

// 🔧 HORARIOS DE ATENCIÓN POR DÍA
const SCHEDULE_BY_DAY = {
  0: { start: 10, end: 15, label: "Domingo" },      // 10:00 AM - 3:00 PM
  1: { start: 9, end: 21, label: "Lunes" },         // 9:00 AM - 9:00 PM
  2: { start: 9, end: 21, label: "Martes" },
  3: { start: 9, end: 21, label: "Miércoles" },
  4: { start: 9, end: 21, label: "Jueves" },
  5: { start: 9, end: 21, label: "Viernes" },
  6: { start: 9, end: 21, label: "Sábado" }
};

const SLOT_MINUTES = 60;

function ensureCalendarConfig() {
  if (!CALENDAR_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    throw new Error("Faltan credenciales de Google Calendar en el .env");
  }
}

function getCalendarClient() {
  ensureCalendarConfig();

  const auth = new google.auth.JWT({
    email: CLIENT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });

  return google.calendar({ version: "v3", auth });
}

function buildDayWindow(baseDate, includeTodayOffset = false) {
  if (!isValid(baseDate)) {
    throw new Error(`Fecha base inválida: ${baseDate}`);
  }

  const dayOfWeek = getDay(baseDate);
  const schedule = SCHEDULE_BY_DAY[dayOfWeek] || { start: 9, end: 21 };

  const dayStart = setMinutes(setHours(startOfDay(baseDate), schedule.start), 0);
  const dayEnd = setMinutes(setHours(startOfDay(baseDate), schedule.end), 0);

  // Si es hoy, ajustar al momento actual si ya pasó el inicio
  const zonedStart = includeTodayOffset
    ? maxDate([dayStart, baseDate]) 
    : dayStart;

  console.log(`📅 Ventana para ${format(baseDate, 'yyyy-MM-dd')}: ${format(zonedStart, 'HH:mm')} - ${format(dayEnd, 'HH:mm')}`);

  return { start: zonedStart, end: dayEnd };
}

function getFreeSlots(busyIntervals, windowStart, windowEnd) {
  const slots = [];
  const busy = busyIntervals
    .filter(i => isValid(i.start) && isValid(i.end))
    .sort((a, b) => a.start - b.start);

  console.log(`🔍 Buscando slots libres entre ${format(windowStart, 'HH:mm')} y ${format(windowEnd, 'HH:mm')}`);
  console.log(`🚫 Intervalos ocupados: ${busy.length}`);
  
  busy.forEach((interval, idx) => {
    console.log(`   ${idx + 1}. ${format(interval.start, 'HH:mm')} - ${format(interval.end, 'HH:mm')}`);
  });

  for (
    let slotStart = windowStart;
    isBefore(slotStart, windowEnd);
    slotStart = addMinutes(slotStart, SLOT_MINUTES)
  ) {
    const slotEnd = addMinutes(slotStart, SLOT_MINUTES);
    
    // Verificar que el slot completo esté dentro de la ventana
    if (isBefore(slotEnd, windowStart) || isAfter(slotStart, windowEnd)) {
      continue;
    }

    // Verificar si el slot se solapa con algún intervalo ocupado
    const overlaps = busy.some((interval) => {
      // Un slot se solapa si:
      // - El inicio del slot está antes del fin del intervalo Y
      // - El fin del slot está después del inicio del intervalo
      return isBefore(slotStart, interval.end) && isAfter(slotEnd, interval.start);
    });

    if (!overlaps) {
      slots.push(slotStart);
      console.log(`✅ Slot libre: ${format(slotStart, 'HH:mm')} - ${format(slotEnd, 'HH:mm')}`);
    }
  }

  console.log(`📊 Total slots libres encontrados: ${slots.length}`);
  return slots;
}

function groupConsecutiveSlots(slots) {
  if (!slots.length) return [];

  const ranges = [];
  let rangeStart = slots[0];
  let rangeEnd = addMinutes(rangeStart, SLOT_MINUTES);

  for (let i = 1; i < slots.length; i++) {
    const current = slots[i];
    if (+current === +rangeEnd) {
      // Slot consecutivo, extender el rango
      rangeEnd = addMinutes(rangeEnd, SLOT_MINUTES);
    } else {
      // Gap encontrado, guardar rango actual
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = current;
      rangeEnd = addMinutes(current, SLOT_MINUTES);
    }
  }

  ranges.push({ start: rangeStart, end: rangeEnd });
  return ranges;
}

function formatDayAvailability(dateLabel, ranges) {
  if (!ranges.length) return null;

  const rangeText = ranges
    .map(({ start, end }) => {
      try {
        const startStr = formatInTimeZone(start, TIMEZONE, "h:mm a");
        const endStr = formatInTimeZone(end, TIMEZONE, "h:mm a");
        return `${startStr} - ${endStr}`;
      } catch (err) {
        console.error("⚠️ Error formateando rango:", err.message);
        return null;
      }
    })
    .filter(Boolean)
    .join(" | ");

  return rangeText ? `🗓️ *${dateLabel}:* ${rangeText}` : null;
}

function getGenericSchedule() {
  return `📅 *Horarios de atención generales:*

🗓️ *Lunes a Viernes:* 9:00 AM - 9:00 PM
🗓️ *Sábados:* 9:00 AM - 9:00 PM  
🗓️ *Domingos:* 10:00 AM - 3:00 PM

⚠️ *Nota:* Estos son nuestros horarios habituales, pero la disponibilidad específica puede variar. Un miembro de nuestro equipo te confirmará el horario exacto disponible.`;
}

export async function getNextAvailability(days = 3, specificDay = null) {
  try {
    const calendar = getCalendarClient();
    const now = new Date();
    
    console.log(`\n🔍 ========== CONSULTA DE DISPONIBILIDAD ==========`);
    console.log(`📅 Fecha/hora actual: ${format(now, 'yyyy-MM-dd HH:mm:ss')}`);
    console.log(`🌍 Zona horaria: ${TIMEZONE}`);
    console.log(`📆 Días a consultar: ${days}`);
    console.log(`🎯 Día específico solicitado: ${specificDay || 'todos'}`);
    
    if (!isValid(now)) {
      console.error("❌ Fecha actual inválida");
      return getGenericSchedule();
    }

    let zonedNow;
    try {
      zonedNow = toZonedTime(now, TIMEZONE);
      if (!isValid(zonedNow)) {
        throw new Error("Conversión a zona horaria falló");
      }
    } catch (err) {
      console.error(`❌ Error de zona horaria:`, err.message);
      return getGenericSchedule();
    }

    const availabilityLines = [];
    const dayNameMap = {
      'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
      'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0
    };

    for (let i = 0; i < days; i++) {
      try {
        const dayBase = addDays(zonedNow, i);
        
        if (!isValid(dayBase)) {
          console.error(`⚠️ Día ${i} inválido`);
          continue;
        }

        const dayOfWeek = getDay(dayBase);
        const dayName = SCHEDULE_BY_DAY[dayOfWeek]?.label.toLowerCase() || '';

        // Filtrar por día específico si se solicitó
        if (specificDay) {
          const requestedDayNum = dayNameMap[specificDay.toLowerCase()];
          if (requestedDayNum !== undefined && dayOfWeek !== requestedDayNum) {
            console.log(`⏭️ Saltando ${dayName} (no coincide con ${specificDay})`);
            continue;
          }
        }

        console.log(`\n📆 Procesando: ${dayName} ${format(dayBase, 'dd/MM/yyyy')}`);

        const includeTodayOffset = i === 0;
        const { start, end } = buildDayWindow(dayBase, includeTodayOffset);

        if (!isBefore(start, end)) {
          console.log(`⚠️ Ventana inválida (fin antes de inicio), saltando`);
          continue;
        }

        const timeMin = fromZonedTime(start, TIMEZONE).toISOString();
        const timeMax = fromZonedTime(end, TIMEZONE).toISOString();

        console.log(`🔍 Consultando FreeBusy API...`);
        console.log(`   timeMin: ${timeMin}`);
        console.log(`   timeMax: ${timeMax}`);

        const { data } = await calendar.freebusy.query({
          requestBody: {
            timeMin,
            timeMax,
            items: [{ id: CALENDAR_ID }],
            timeZone: TIMEZONE,
          },
        });

        console.log(`📦 Respuesta FreeBusy:`, JSON.stringify(data, null, 2));

        const busyEntries = data?.calendars?.[CALENDAR_ID]?.busy || [];
        console.log(`🚫 Eventos ocupados encontrados: ${busyEntries.length}`);

        const busyIntervals = busyEntries.map(({ start: startIso, end: endIso }) => {
          try {
            return {
              start: toZonedTime(parseISO(startIso), TIMEZONE),
              end: toZonedTime(parseISO(endIso), TIMEZONE),
            };
          } catch (err) {
            console.error("⚠️ Error parseando intervalo:", err.message);
            return null;
          }
        }).filter(Boolean);

        const freeSlots = getFreeSlots(busyIntervals, start, end);
        const ranges = groupConsecutiveSlots(freeSlots);

        const dateLabel = formatInTimeZone(dayBase, TIMEZONE, "EEEE dd/MM");
        const formattedLine = formatDayAvailability(dateLabel, ranges);

        if (formattedLine) {
          availabilityLines.push(formattedLine);
          console.log(`✅ Línea agregada: ${formattedLine}`);
        } else {
          console.log(`⚠️ No hay slots disponibles para este día`);
        }
      } catch (e) {
        console.error(`❌ Error procesando día ${i}:`, e.message);
      }
    }

    console.log(`\n📊 Resumen: ${availabilityLines.length} días con disponibilidad`);
    console.log(`========== FIN CONSULTA ==========\n`);

    if (availabilityLines.length > 0) {
      return [
        "📅 *Estos son los próximos horarios disponibles:*",
        ...availabilityLines,
        `\n⏰ Horario en zona local (${TIMEZONE}).`
      ].join("\n");
    }

    console.log("⚠️ No hay disponibilidad, usando fallback genérico");
    return getGenericSchedule();

  } catch (globalErr) {
    console.error("❌ Error general en Calendar:", globalErr.message, globalErr.stack);
    return getGenericSchedule();
  }
}

const calendarService = { getNextAvailability };
export default calendarService;