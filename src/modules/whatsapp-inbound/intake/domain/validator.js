export function validatePatient(p) {
  const errors = [];
  const warnings = [];

  if (!p.nombre || p.nombre.trim().length === 0) {
    errors.push('El nombre es requerido');
  }

  if (!p.apellidos || p.apellidos.trim().length === 0) {
    errors.push('Los apellidos son requeridos');
  }

  if (p.telefono) {
    if (!/^\d{9}$/.test(p.telefono)) {
      warnings.push(`El teléfono '${p.telefono}' no tiene formato estándar de 9 dígitos`);
    }
  } else {
    warnings.push('No se proporcionó número de teléfono');
  }

  if (p.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
      errors.push(`El email '${p.email}' tiene un formato inválido`);
    }
  } else {
    warnings.push('No se proporcionó correo electrónico');
  }

  if (p.fechaNacimiento) {
    const d = new Date(p.fechaNacimiento);
    if (isNaN(d.getTime())) {
      errors.push('Fecha de nacimiento inválida');
    } else if (d > new Date()) {
      errors.push('La fecha de nacimiento no puede ser futura');
    }
  } else {
    warnings.push('No se proporcionó fecha de nacimiento');
  }

  if (p.dni) {
    if (!/^\d{8}$/.test(p.dni)) {
      warnings.push(`DNI '${p.dni}' no tiene 8 dígitos`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}
