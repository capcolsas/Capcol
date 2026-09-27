export const EMPLOYEE_RETIREMENT_REASONS = Object.freeze([
  { value:'renuncia', label:'Renuncia' },
  { value:'mutuo_acuerdo', label:'Mutuo Acuerdo' },
  { value:'vencimiento_contrato', label:'Vencimiento Contrato' },
  { value:'finalizacion_obra_labor', label:'Finalización Obra/Labor' },
  { value:'despido_justa_causa', label:'Despido Justa Causa' },
  { value:'despido_sin_justa_causa', label:'Despido sin Justa Causa' },
  { value:'fallecimiento', label:'Fallecimiento' },
  { value:'liquidacion_empresa', label:'Liquidación Empresa' },
  { value:'abandono_cargo', label:'Abandono Cargo' },
  { value:'sentencia_judicial', label:'Sentencia Judicial' },
  { value:'pension_jubilacion', label:'Pensión/Jubilación' },
  { value:'periodo_prueba', label:'Periodo Prueba' }
]);

export function retirementReasonLabel(code) {
  return EMPLOYEE_RETIREMENT_REASONS.find(reason=>reason.value===code)?.label || 'Motivo no registrado';
}

export function validateRetirementDetails(reason, observation) {
  if (!EMPLOYEE_RETIREMENT_REASONS.some(item=>item.value===reason)) {
    throw new Error('Selecciona un motivo de retiro válido.');
  }
  if (!String(observation || '').trim()) throw new Error('Escribe la observación del retiro.');
}
