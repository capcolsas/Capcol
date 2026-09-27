import { showActionModal } from '../utils/actionModal.js';

export function contractActions(deps) {
  function contractFields(contract = {}, { includeCode = true, readonlyCode = false } = {}) {
    const fields = [
      { id: 'nombre', label: 'Nombre contrato', type: 'text', required: true, value: contract.nombre || '', placeholder: 'Nombre del contrato' },
      { id: 'numeroContrato', label: 'Numero contrato', type: 'text', value: contract.numeroContrato || '' },
      { id: 'clienteNombre', label: 'Cliente', type: 'text', required: true, value: contract.clienteNombre || '', placeholder: 'Nombre del cliente' },
      { id: 'clienteNit', label: 'NIT cliente', type: 'text', value: contract.clienteNit || '' },
      { id: 'clienteContacto', label: 'Contacto cliente', type: 'text', value: contract.clienteContacto || '' },
      { id: 'clienteEmail', label: 'Email cliente', type: 'email', value: contract.clienteEmail || '' },
      { id: 'clienteTelefono', label: 'Telefono cliente', type: 'text', value: contract.clienteTelefono || '' },
      { id: 'fechaInicio', label: 'Fecha inicio', type: 'date', value: contract.fechaInicio || '' },
      { id: 'fechaFin', label: 'Fecha fin', type: 'date', value: contract.fechaFin || '' }
    ];
    if (includeCode) fields.unshift(
      { id: 'codigo', label: 'Codigo', type: 'text', required: true, readonly: readonlyCode, value: contract.codigo || '' },
    );
    return fields;
  }

  async function openCreateModal() {
    const modal = await showActionModal({
      title: 'Crear contrato',
      message: 'Completa la informacion del contrato y su cliente. El codigo se asignara automaticamente.',
      confirmText: 'Crear contrato',
      fields: contractFields({}, { includeCode: false })
    });
    if (!modal.confirmed) return;
    const payload = readContractPayload(modal.values, { requireCode: false });
    if (!payload) return;
    try {
      const code = await deps.getNextContractCode?.();
      if (!code) throw new Error('No se pudo generar el codigo del contrato.');
      payload.codigo = code;
      const id = await deps.createContract?.(payload);
      await deps.addAuditLog?.({ targetType: 'contract', targetId: id, action: 'create_contract', after: { ...payload, estado: 'activo' } });
      alert('Contrato creado OK');
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }

  async function openEditModal(contract) {
    const modal = await showActionModal({
      title: 'Editar contrato',
      message: `Contrato: ${contract.nombre || '-'}`,
      confirmText: 'Guardar cambios',
      fields: [
        ...contractFields(contract, { readonlyCode: true }),
        { id: 'detail', label: 'Detalle de la modificacion', type: 'textarea', required: true, placeholder: 'Describe brevemente el cambio realizado' }
      ]
    });
    if (!modal.confirmed) return;
    const payload = readContractPayload(modal.values);
    if (!payload) return;
    payload.codigo = contract.codigo || payload.codigo;
    const updatePayload = { ...payload };
    delete updatePayload.codigo;
    try {
      await deps.updateContract?.(contract.id, updatePayload);
      await deps.addAuditLog?.({ targetType: 'contract', targetId: contract.id, action: 'update_contract', before: contract, after: payload, note: modal.values.detail || null });
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }

  async function toggleStatus(contract) {
    const target = contract.estado === 'activo' ? 'inactivo' : 'activo';
    const modal = await showActionModal({
      title: `${target === 'inactivo' ? 'Desactivar' : 'Activar'} contrato`,
      message: `Contrato: ${contract.nombre || '-'}`,
      confirmText: target === 'inactivo' ? 'Desactivar' : 'Activar',
      fields: [{ id: 'detail', label: 'Detalle', type: 'textarea', required: true, placeholder: 'Escribe el motivo o detalle de esta accion' }]
    });
    if (!modal.confirmed) return;
    try {
      await deps.setContractStatus?.(contract.id, target);
      await deps.addAuditLog?.({ targetType: 'contract', targetId: contract.id, action: target === 'activo' ? 'activate_contract' : 'deactivate_contract', before: { estado: contract.estado }, after: { estado: target }, note: modal.values.detail || null });
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }

  function readContractPayload(values = {}, { requireCode = true } = {}) {
    const payload = {
      codigo: String(values.codigo || '').trim(),
      nombre: String(values.nombre || '').trim(),
      numeroContrato: String(values.numeroContrato || '').trim(),
      clienteNombre: String(values.clienteNombre || '').trim(),
      clienteNit: String(values.clienteNit || '').trim(),
      clienteContacto: String(values.clienteContacto || '').trim(),
      clienteEmail: String(values.clienteEmail || '').trim(),
      clienteTelefono: String(values.clienteTelefono || '').trim(),
      fechaInicio: String(values.fechaInicio || '').trim(),
      fechaFin: String(values.fechaFin || '').trim()
    };
    if ((requireCode && !payload.codigo) || !payload.nombre || !payload.clienteNombre) {
      alert(requireCode ? 'Completa codigo, nombre del contrato y cliente.' : 'Completa nombre del contrato y cliente.');
      return null;
    }
    if (payload.fechaInicio && payload.fechaFin && payload.fechaInicio > payload.fechaFin) {
      alert('La fecha de inicio no puede ser posterior a la fecha fin.');
      return null;
    }
    return payload;
  }
  return { openCreateModal, openEditModal, toggleStatus };
}
