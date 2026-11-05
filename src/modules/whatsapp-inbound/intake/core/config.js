export function loadConfig(env = process.env) {
  const missing = [];
  
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID || '11FUaTEL_EsrmvDi4758MTDtrujfu-Xzjh4_YEUtASBE';
  const required = [
    'GEMINI_API_KEY',
    'GOOGLE_CALENDAR_CLIENT_EMAIL',
    'GOOGLE_CALENDAR_PRIVATE_KEY'
  ];

  for (const key of required) {
    if (!env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(`Configuración incompleta. Faltan variables: ${missing.join(', ')}`);
  }

  const staffPhones = (env.AUTHORIZED_STAFF_PHONES || '51922346747,51936597327')
    .split(',')
    .map(p => p.trim().replace(/\D/g, ''))
    .filter(Boolean);

  return {
    port: parseInt(env.PORT || '3005', 10),
    apiKey: env.INTAKE_API_KEY || 'fh_intake_dev_secret_key_2026',
    staffPhones,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    googleSheets: {
      spreadsheetId,
      clientEmail: env.GOOGLE_CALENDAR_CLIENT_EMAIL,
      privateKey: (env.GOOGLE_CALENDAR_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    },
    whatsapp: {
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      apiToken: env.WHATSAPP_API_TOKEN || ''
    }
  };
}
