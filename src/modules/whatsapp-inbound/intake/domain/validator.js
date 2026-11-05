export function validatePatient(p) {
  const errors = [];
  const warnings = [];

  if (!p.nombre || p.nombre.trim().length === 0) {
    errors.push('El nombre es requerido');
  }

  if (!p.apellidos || p.apellidos.trim().length === 0) {
    errors.push('Los apellidos son requeridos');
  }

  // Teléfono obligatorio
  if (!p.telefono || p.telefono.trim().length === 0) {
    errors.push('El teléfono es obligatorio');
  } else if (!/^\d{9}$/.test(p.telefono)) {
    errors.push(`El teléfono '${p.telefono}' debe tener 9 dígitos numéricos`);
  }

  // Correo electrónico obligatorio
  if (!p.email || p.email.trim().length === 0) {
    errors.push('El correo electrónico es obligatorio');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    errors.push(`El correo '${p.email}' tiene un formato inválido`);
  }

  // Fecha de nacimiento (opcional, si viene debe ser válida y no futura)
  if (p.fechaNacimiento) {
    const d = new Date(p.fechaNacimiento);
    if (isNaN(d.getTime())) {
      errors.push('Fecha de nacimiento inválida');
    } else if (d > new Date()) {
      errors.push('La fecha de nacimiento no puede ser futura');
    }
  }

  // DNI (opcional, si viene advertir si no tiene 8 dígitos)
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
