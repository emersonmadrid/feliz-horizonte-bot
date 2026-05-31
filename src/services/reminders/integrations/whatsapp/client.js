import axios from "axios";
import { formatDateLabel, formatHour } from "../../core/time.js";

function buildTemplatePayload(config, to, templateName, bodyParameters) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: config.whatsappLanguageCode },
      components: [
        {
          type: "body",
          parameters: bodyParameters.map((text) => ({
            type: "text",
            text,
          })),
        },
      ],
    },
  };
}

async function sendTemplate(config, to, templateName, bodyParameters) {
  const url = `https://graph.facebook.com/v20.0/${config.whatsappPhoneNumberId}/messages`;

  const response = await axios.post(
    url,
    buildTemplatePayload(config, to, templateName, bodyParameters),
    {
      headers: {
        Authorization: `Bearer ${config.whatsappApiToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  return response.data;
}

export async function sendSameDayReminder(config, appointment) {
  const timezone = appointment.timezone || config.timezone;

  return sendTemplate(
    config,
    appointment.patientPhone,
    config.whatsappTemplateSameDay,
    [
      appointment.patientName,
      formatDateLabel(appointment.startsAt, timezone),
      formatHour(appointment.startsAt, timezone),
    ]
  );
}

export async function sendOneHourReminder(config, appointment) {
  const timezone = appointment.timezone || config.timezone;

  return sendTemplate(
    config,
    appointment.patientPhone,
    config.whatsappTemplateOneHour,
    [appointment.patientName, formatHour(appointment.startsAt, timezone)]
  );
}
