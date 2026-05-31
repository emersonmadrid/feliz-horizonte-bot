import { loadConfig, validateCronSecret } from "../../src/services/reminders/core/config.js";
import { buildAdminSummary } from "../../src/services/reminders/services/admin-summary.js";

function validateAdminSecret(req) {
  const adminApiKey = process.env.ADMIN_API_KEY;
  const authHeader = req.headers.authorization;
  const adminHeader = req.headers["x-admin-api-key"];

  if (adminApiKey && (authHeader === `Bearer ${adminApiKey}` || adminHeader === adminApiKey)) {
    return true;
  }

  return validateCronSecret(req);
}

export default async function handler(req, res) {
  if (!validateAdminSecret(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const config = loadConfig();
    const summary = await buildAdminSummary(config);
    return res.status(200).json(summary);
  } catch (error) {
    console.error("❌ Error building admin summary:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
