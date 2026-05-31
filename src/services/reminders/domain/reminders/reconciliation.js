import { cancelMissingCalendlyAppointments } from "../../persistence/appointments.js";

export function getActiveAppointmentIds(appointments = []) {
  return appointments
    .map((appointment) => appointment?.id)
    .filter(Boolean);
}

export async function reconcileCalendlyApiSnapshot(
  config,
  appointments = [],
  { cancelMissingAppointments = cancelMissingCalendlyAppointments } = {}
) {
  const activeAppointmentIds = getActiveAppointmentIds(appointments);
  const cancelledMissingCount = await cancelMissingAppointments(config, activeAppointmentIds);

  return {
    source: "calendly_api",
    activeAppointmentIds,
    activeCount: activeAppointmentIds.length,
    cancelledMissingCount,
  };
}
