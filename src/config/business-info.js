// src/config/business-info.js
export const BUSINESS = {
  name: "Feliz Horizonte",
  website: "https://felizhorizonte.pe",
  country: "Perú",
  timezone: "America/Lima",

  services: {
    therapy_individual: {
      name: "Terapia Psicológica Individual",
      price_pen: 85,
      duration_min: 50,
      modality: "Presencial u online (Zoom o Google Meet)",
      professional: "Lic. Cintya Isabel (Psicóloga colegiada)",
      approach: "Cognitivo–conductual",
      for: ["ansiedad", "depresión", "estrés", "autoestima", "duelo"]
    },
    therapy_couples: {
      name: "Terapia de Parejas",
      price_pen: 100,
      duration_min: 50,
      modality: "Presencial u online (Zoom o Google Meet)",
      professional: "Lic. Cintya Isabel (Psicóloga colegiada)",
      approach: "Cognitivo–conductual"
    },
    therapy_family: {
      name: "Terapia Familiar",
      price_pen: 100,
      duration_min: 50,
      modality: "Presencial u online (Zoom o Google Meet)",
      professional: "Lic. Cintya Isabel (Psicóloga colegiada)",
      approach: "Cognitivo–conductual"
    },
    psychiatry: {
      name: "Consulta Psiquiátrica",
      price_pen: 139,
      modality: "100% online (Zoom o Google Meet)",
      professional: "Dra. Yasmín Meneses (Médica psiquiatra)",
      includes: ["evaluación médica", "diagnóstico", "prescripción si es necesario"]
    }
  },

  payments: ["Yape", "Plin", "Transferencia bancaria"],

  policies: {
    rescheduling: "Reprogramación con 24 horas de anticipación sin penalización.",
    confidentiality: "Confidencialidad 100% garantizada según el código de ética profesional.",
    first_session: "La primera sesión es de evaluación inicial.",
    by_appointment_only: "Solo con cita previa (no hay atención sin agendar)."
  },

  schedule_hint: {
    weekdays: "Lunes a Viernes: 9:00 A.M–8:00 P.M",
    saturday: "Sábados: 9:00 A.M–9:00 P.M",
    sunday: "Domingo: 10:00 A.M–3:00 P.M",
    note: "Confirmar disponibilidad exacta antes de comprometer horarios."
  },

  differences: {
    psychologist: "Terapia conversacional, estrategias de afrontamiento y cambio de patrones.",
    psychiatrist: "Médica(o) que puede recetar medicamentos además de terapia."
  },

  calendly: {
    therapy: process.env.CALENDLY_THERAPY_URL || "",
    psychiatry: process.env.CALENDLY_PSYCHIATRY_URL || ""
  }
};
