import { buildPatientName, googleGet, normalizeEmail } from "./shared.js";

export async function fetchPatientsSheet(config) {
  const range = `${config.googleSheetsSheetName}!A1:Z`;
  const data = await googleGet(
    config,
    `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetsSpreadsheetId}/values/${encodeURIComponent(
      range
    )}`,
    {}
  );

  const [headerRow = [], ...rows] = data.values || [];
  const headerIndex = new Map(headerRow.map((value, index) => [String(value || "").trim(), index]));

  const getCell = (row, columnName) => {
    const index = headerIndex.get(columnName);
    return index === undefined ? "" : String(row[index] || "").trim();
  };

  const patientsByEmail = new Map();

  for (const row of rows) {
    const email = normalizeEmail(getCell(row, config.googleSheetsEmailColumn));
    const phone = getCell(row, config.googleSheetsPhoneColumn);

    if (!email || !phone) {
      continue;
    }

    const patient = {
      email,
      phone,
      firstName: getCell(row, config.googleSheetsFirstNameColumn),
      lastName: getCell(row, config.googleSheetsLastNameColumn),
    };

    patient.fullName = buildPatientName(patient);
    patientsByEmail.set(email, patient);
  }

  return patientsByEmail;
}
