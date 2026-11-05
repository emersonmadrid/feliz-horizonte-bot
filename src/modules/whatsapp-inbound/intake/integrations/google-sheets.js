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
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Pacientes!A2:X`;

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

export function stripAccents(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export async function findPatient(target, config) {
  if (!target || !String(target).trim()) {
    return { found: false, reason: 'empty_target' };
  }

  const token = await getAccessToken(config);
  const pacUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Pacientes!A2:X`;
  const pacRes = await fetch(pacUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!pacRes.ok) {
    throw new Error(`Error consultando Pacientes: ${pacRes.statusText}`);
  }
  const pacData = await pacRes.json();
  const pacRows = pacData.values || [];

  const cleanTarget = String(target).trim();
  const cleanTargetNorm = stripAccents(cleanTarget);
  const digits = cleanTarget.replace(/\D/g, '');

  // 1. Coincidencia por ID exacto (si target es puramente numérico hasta 5 dígitos)
  if (/^\d{1,5}$/.test(cleanTarget)) {
    const idx = pacRows.findIndex(r => String(r[0] || '').trim() === cleanTarget);
    if (idx !== -1) {
      const row = pacRows[idx];
      return {
        found: true,
        patient: {
          id: String(row[0]),
          nombre: `${row[1] || ''} ${row[2] || ''}`.trim(),
          estado: (row[18] || '').trim().toUpperCase(),
          rowIndex: idx + 2,
          row
        }
      };
    }
  }

  // 2. Coincidencia por celular (si tiene 8 o más dígitos)
  if (digits.length >= 8) {
    const idx = pacRows.findIndex(r => {
      const pPhone = String(r[6] || '').replace(/\D/g, '');
      return pPhone && (pPhone === digits || pPhone.endsWith(digits) || digits.endsWith(pPhone));
    });
    if (idx !== -1) {
      const row = pacRows[idx];
      return {
        found: true,
        patient: {
          id: String(row[0]),
          nombre: `${row[1] || ''} ${row[2] || ''}`.trim(),
          estado: (row[18] || '').trim().toUpperCase(),
          rowIndex: idx + 2,
          row
        }
      };
    }
  }

  // 3. Coincidencia por palabras del nombre del paciente
  const words = cleanTargetNorm.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 0) {
    const matches = [];
    for (let i = 0; i < pacRows.length; i++) {
      const row = pacRows[i];
      const fullNameNorm = stripAccents(`${row[1] || ''} ${row[2] || ''}`);
      if (words.every(w => fullNameNorm.includes(w))) {
        matches.push({
          id: String(row[0]),
          nombre: `${row[1] || ''} ${row[2] || ''}`.trim(),
          estado: (row[18] || '').trim().toUpperCase(),
          rowIndex: i + 2,
          row
        });
      }
    }

    if (matches.length === 1) {
      return { found: true, patient: matches[0] };
    }
    if (matches.length > 1) {
      return {
        found: false,
        reason: 'multiple',
        matches: matches.map(m => ({ id: m.id, nombre: m.nombre }))
      };
    }
  }

  return { found: false, reason: 'not_found', target: cleanTarget };
}

export async function updatePatientRow(target, updates, updaterEmail, config) {
  const findRes = await findPatient(target, config);
  if (!findRes.found) {
    return {
      success: false,
      reason: findRes.reason,
      target: target,
      matches: findRes.matches
    };
  }

  const patient = findRes.patient;
  if (patient.estado === 'ARCHIVADO') {
    return {
      success: false,
      reason: 'archived',
      id: patient.id,
      nombre: patient.nombre
    };
  }

  const sheetRowNumber = patient.rowIndex;
  const updatedRow = [...patient.row];

  while (updatedRow.length < 24) {
    updatedRow.push('');
  }

  const modifiedFields = [];

  if (updates.nombre) {
    updatedRow[1] = updates.nombre;
    modifiedFields.push({ label: 'Nombre', value: updates.nombre });
  }
  if (updates.apellidos) {
    updatedRow[2] = updates.apellidos;
    modifiedFields.push({ label: 'Apellidos', value: updates.apellidos });
  }
  if (updates.dni) {
    updatedRow[3] = updates.dni;
    modifiedFields.push({ label: 'DNI', value: updates.dni });
  }
  if (updates.fechaNacimiento) {
    updatedRow[4] = updates.fechaNacimiento;
    modifiedFields.push({ label: 'F. Nacimiento', value: updates.fechaNacimiento });
  }
  if (updates.sexo) {
    updatedRow[5] = updates.sexo;
    modifiedFields.push({ label: 'Sexo', value: updates.sexo });
  }
  if (updates.telefono) {
    updatedRow[6] = updates.telefono;
    modifiedFields.push({ label: 'Celular', value: updates.telefono });
  }
  if (updates.email) {
    updatedRow[7] = updates.email;
    modifiedFields.push({ label: 'Email', value: updates.email });
  }
  if (updates.direccion) {
    updatedRow[8] = updates.direccion;
    modifiedFields.push({ label: 'Dirección', value: updates.direccion });
  }
  if (updates.grado) {
    updatedRow[10] = updates.grado;
    modifiedFields.push({ label: 'Grado', value: updates.grado });
  }
  if (updates.trabajo || updates.ocupacion) {
    const jobVal = updates.trabajo || updates.ocupacion;
    updatedRow[11] = jobVal;
    if (updates.ocupacion) {
      updatedRow[13] = updates.ocupacion;
    }
    modifiedFields.push({ label: 'Ocupación/Trabajo', value: jobVal });
  }
  if (updates.estadocivil) {
    updatedRow[12] = updates.estadocivil;
    modifiedFields.push({ label: 'Estado Civil', value: updates.estadocivil });
  }
  if (updates.observaciones) {
    const prevObs = (updatedRow[14] || '').trim();
    updatedRow[14] = prevObs ? `${prevObs} | ${updates.observaciones}` : updates.observaciones;
    modifiedFields.push({ label: 'Observaciones', value: updatedRow[14] });
  }

  const nowPeru = formatPeruDate();
  updatedRow[20] = nowPeru;
  updatedRow[21] = updaterEmail || 'whatsapp-bot';

  const token = await getAccessToken(config);
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Pacientes!A${sheetRowNumber}:X${sheetRowNumber}?valueInputOption=USER_ENTERED`;

  const updateRes = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [updatedRow]
    })
  });

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Error actualizando fila en Google Sheets: ${errText}`);
  }

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
          'ACTUALIZAR',
          'PACIENTE',
          String(patient.id),
          JSON.stringify({
            origen: 'whatsapp_intake_update',
            actualizadoPor: updaterEmail,
            modificaciones: modifiedFields
          })
        ]]
      })
    });
  } catch (auditErr) {
    console.warn('Auditoría no registrada (no crítico):', auditErr.message);
  }

  return {
    success: true,
    id: patient.id,
    fullName: `${updatedRow[1]} ${updatedRow[2]}`.trim() || patient.nombre,
    modifiedFields
  };
}

export async function insertClinicalHistoryRow({ target, historyData, senderPhone, config }) {
  const findRes = await findPatient(target, config);
  if (!findRes.found) {
    return {
      success: false,
      reason: findRes.reason,
      target: target,
      matches: findRes.matches
    };
  }

  const patient = findRes.patient;
  if (patient.estado === 'ARCHIVADO') {
    return {
      success: false,
      reason: 'archived',
      id: patient.id,
      nombre: patient.nombre
    };
  }

  const token = await getAccessToken(config);

  const histIdUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Historia!A:A`;
  const histIdRes = await fetch(histIdUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!histIdRes.ok) {
    throw new Error(`Error consultando IDs en Historia: ${histIdRes.statusText}`);
  }
  const histIdData = await histIdRes.json();
  const histRows = histIdData.values || [];
  let maxId = 0;
  for (let i = 1; i < histRows.length; i++) {
    const n = parseInt(histRows[i][0], 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  }
  const nextHistoryId = maxId + 1;

  let medico = historyData.medico || '';
  if (!medico) {
    const cleanSender = String(senderPhone || '').replace(/\D/g, '');
    if (cleanSender.includes('922346747')) {
      medico = 'HUAUYA MACAVILCA CINTYA';
    } else if (cleanSender.includes('936597327')) {
      medico = 'EMERSON MADRID';
    } else {
      medico = 'STAFF FELIZ HORIZONTE';
    }
  }

  const nowPeru = formatPeruDate();
  const fechaConsulta = historyData.fecha || nowPeru;

  const newRow = [
    String(nextHistoryId),
    String(patient.id),
    fechaConsulta,
    historyData.motivo || '',
    historyData.sintomas || '',
    historyData.diagnostico || '',
    historyData.tratamiento || '',
    historyData.observaciones || '',
    medico,
    historyData.signos || '',
    'ACTIVO'
  ];

  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheets.spreadsheetId}/values/Historia!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const appendRes = await fetch(appendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [newRow] })
  });

  if (!appendRes.ok) {
    const errText = await appendRes.text();
    throw new Error(`Error insertando fila en Historia: ${errText}`);
  }

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
          'HISTORIA',
          String(nextHistoryId),
          JSON.stringify({
            origen: 'whatsapp_clinical_history',
            pacienteId: patient.id,
            pacienteNombre: patient.nombre,
            medico: medico,
            creadoPor: `whatsapp:${senderPhone}`
          })
        ]]
      })
    });
  } catch (auditErr) {
    console.warn('Auditoría no registrada (no crítico):', auditErr.message);
  }

  return {
    success: true,
    historyId: nextHistoryId,
    patientId: patient.id,
    patientName: patient.nombre,
    fecha: fechaConsulta,
    medico: medico,
    motivo: historyData.motivo,
    tratamiento: historyData.tratamiento
  };
}
