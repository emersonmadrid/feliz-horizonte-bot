import axios from "axios";
import crypto from "crypto";

let cachedToken = null;

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizePrivateKey(value) {
  return value.replace(/\\n/g, "\n");
}

async function getAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.value;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: config.googleCalendarClientEmail,
    scope: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ].join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(config.googleCalendarPrivateKey));
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    }
  );

  cachedToken = {
    value: response.data.access_token,
    expiresAt: now + Number(response.data.expires_in || 3600),
  };

  return cachedToken.value;
}

export async function googleGet(config, url, params) {
  try {
    const accessToken = await getAccessToken(config);
    const response = await axios.get(url, {
      params,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20000,
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorMessage =
        error.response?.data?.error?.message || error.response?.data?.error_description;

      if (status === 403 && url.includes("sheets.googleapis.com")) {
        throw new Error(
          `Google Sheets access denied. Share the sheet with ${config.googleCalendarClientEmail}.`
        );
      }

      if (status && errorMessage) {
        throw new Error(`Google API error ${status}: ${errorMessage}`);
      }
    }

    throw error;
  }
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function extractEmailFromText(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? normalizeEmail(match[0]) : null;
}

export function buildPatientName(row) {
  const parts = [row.firstName, row.lastName].filter(Boolean);
  return parts.join(" ").trim();
}
