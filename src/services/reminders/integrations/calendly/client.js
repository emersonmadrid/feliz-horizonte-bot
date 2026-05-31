import axios from "axios";

const CALENDLY_API_BASE_URL = "https://api.calendly.com";

export async function calendlyGet(config, path, params = {}) {
  if (!config.calendlyApiToken) {
    throw new Error("CALENDLY_API_TOKEN is required for Calendly API polling");
  }

  try {
    const response = await axios.get(`${CALENDLY_API_BASE_URL}${path}`, {
      params,
      headers: {
        Authorization: `Bearer ${config.calendlyApiToken}`,
      },
      timeout: 20000,
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.response?.data?.title;
      const requiredScopes = error.response?.data?.required_scopes;

      if (status && message) {
        const scopes = Array.isArray(requiredScopes) ? ` Required scopes: ${requiredScopes.join(", ")}` : "";
        throw new Error(`Calendly API error ${status}: ${message}.${scopes}`);
      }
    }

    throw error;
  }
}

export async function fetchCalendlyCurrentUser(config) {
  const data = await calendlyGet(config, "/users/me");
  return data.resource;
}

export async function fetchCalendlyScheduledEvents(config, { userUri, organizationUri }) {
  const data = await calendlyGet(config, "/scheduled_events", {
    user: userUri,
    organization: organizationUri,
    min_start_time: new Date().toISOString(),
    max_start_time: new Date(Date.now() + config.calendlyLookaheadDays * 24 * 60 * 60 * 1000).toISOString(),
    sort: "start_time:asc",
    count: 100,
  });

  return data.collection || [];
}

export async function fetchCalendlyEventInvitees(config, eventUri) {
  const eventId = String(eventUri || "").split("/").filter(Boolean).at(-1);
  if (!eventId) {
    return [];
  }

  const data = await calendlyGet(config, `/scheduled_events/${eventId}/invitees`, {
    count: 100,
    sort: "created_at:asc",
  });

  return data.collection || [];
}
