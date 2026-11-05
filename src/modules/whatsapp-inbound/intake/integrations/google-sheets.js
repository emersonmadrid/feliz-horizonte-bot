import crypto from 'crypto';

let cachedToken = null;

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function getAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: config.googleSheets.clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(config.googleSheets.privateKey);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const bodyParams = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error autenticando Service Account en Google: ${errText}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in
  };

  return cachedToken.token;
}

function formatPeruDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(date).replace(',', '');
}

export async function lookupLeadGclid(codigoLead, config) {
  if (!codigoLead) return '';
  const token = await getAccessToken(config);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Leads!A2:B`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return '';
    const data = await res.json();
    const rows = data.values || [];
    const cleanTarget = String(codigoLead).trim().toUpperCase();

    for (const [code, gclid] of rows) {
      if (String(code || '').trim().toUpperCase() === cleanTarget) {
        return gclid || '';
      }
    }
  } catch (e) {
    console.warn('No se pudo consultar la hoja Leads:', e.message);
  }
  return '';
}

export async function checkExistingPatient(phone, email, config) {
  const token = await getAccessToken(config);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Pacientes!A2:H`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Error consultando Pacientes: ${res.statusText}`);
  }

  const data = await res.json();
  const rows = data.values || [];

  const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
  const cleanEmail = email ? String(email).trim().toLowerCase() : null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowId = row[0];
    const rowNombre = `${row[1] || ''} ${row[2] || ''}`.trim();
    const rowPhone = (row[6] || '').replace(/\D/g, '');
    const rowEmail = (row[7] || '').trim().toLowerCase();
    const rowEstado = (row[18] || '').trim().toUpperCase();

    // Si el registro está archivado (eliminación lógica), no se considera duplicado activo
    if (rowEstado === 'ARCHIVADO') {
      continue;
    }

    if (cleanPhone && rowPhone && cleanPhone === rowPhone) {
      return { exists: true, id: rowId, nombre: rowNombre, motivo: 'celular_coincidente' };
    }
    if (cleanEmail && rowEmail && cleanEmail === rowEmail) {
      return { exists: true, id: rowId, nombre: rowNombre, motivo: 'email_coincidente' };
    }
  }

  // Obtener el próximo ID numérico
  let maxId = 0;
  for (const row of rows) {
    const num = parseInt(row[0], 10);
    if (!isNaN(num) && num > maxId) {
      maxId = num;
    }
  }

  return { exists: false, nextId: maxId + 1 };
}

export async function insertPatientRow(patient, creatorEmail, config) {
  const token = await getAccessToken(config);

  // 1. Verificar duplicados y obtener siguiente ID
  const check = await checkExistingPatient(patient.telefono, patient.email, config);
  if (check.exists) {
    return {
      created: false,
      alreadyExisted: true,
      existingId: check.id,
      existingNombre: check.nombre,
      motivo: check.motivo
    };
  }

  const newId = check.nextId;

  // 2. Si viene un código lead, buscar el gclid
  let gclid = '';
  if (patient.codigoLead) {
    gclid = await lookupLeadGclid(patient.codigoLead, config);
  }

  // Formato de columnas según SYSTEM_COLUMNS.PACIENTES en Consultorio
  // 1:ID, 2:Nombre, 3:Apellidos, 4:DNI, 5:Fecha_Nacimiento, 6:Sexo, 7:Telefono, 8:Email,
  // 9:Direccion, 10:Fecha_Registro, 11:Grado, 12:Trabajo, 13:ESTADOCIVIL, 14:Ocupacion,
  // 15:Motivo, 16:Ref_Ads, 17:Valor_Conversion, 18:Subido_a_Ads, 19:ESTADO, 20:CREADO_POR
  const nowPeru = formatPeruDate();

  const newRow = [
    String(newId),
    patient.nombre || '',
    patient.apellidos || '',
    patient.dni || '',
    patient.fechaNacimiento || '',
    patient.sexo || '',
    patient.telefono || '',
    patient.email || '',
    patient.direccion || '',
    nowPeru,
    patient.grado || '',
    patient.trabajo || '',
    patient.estadocivil || '',
    '', // Ocupacion adicional
    patient.observaciones || '', // Motivo / observaciones
    gclid,
    '', // Valor_Conversion
    '', // Subido_a_Ads
    'ACTIVO',
    creatorEmail || 'whatsapp-bot'
  ];

  // Append a Pacientes
  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Pacientes!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const appendRes = await fetch(appendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [newRow]
    })
  });

  if (!appendRes.ok) {
    const errText = await appendRes.text();
    throw new Error(`Error insertando fila en Google Sheets: ${errText}`);
  }

  // Registrar auditoría si existe la pestaña Auditoria
  try {
    const auditUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Auditoria!A1:append?valueInputOption=USER_ENTERED`;
    await fetch(auditUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [[
          nowPeru,
          'CREAR',
          'PACIENTE',
          String(newId),
          JSON.stringify({
            origen: 'whatsapp_intake',
            creadoPor: creatorEmail,
            paciente: `${patient.nombre} ${patient.apellidos}`
          })
        ]]
      })
    });
  } catch (auditErr) {
    console.warn('Auditoría no registrada (no crítico):', auditErr.message);
  }

  return {
    created: true,
    id: newId,
    fullName: `${patient.nombre} ${patient.apellidos}`.trim(),
    telefono: patient.telefono,
    gclidAsignado: !!gclid
  };
}
