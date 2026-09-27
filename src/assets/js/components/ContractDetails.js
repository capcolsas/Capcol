import { el, lucideInlineIcon } from '../utils/dom.js';
import { subscribe } from '../state.js';
import { contractFilterCode } from '../utils/contractScope.js';
import { dateAt } from './dashboards/contractDashboardDemo.js';

export function ContractDetails(mount, deps = {}) {
  const ui = el('section', { className: 'main-card contract-details' });
  let contracts = [];
  let status = 'loading';
  let disposed = false;
  let version = 0;
  let failedLoad = false;
  mount.replaceChildren(ui);

  function section(title, fields) {
    return el('div', { className: 'table-wrap contract-details__table-wrap' }, [
      el('table', { className: 'table contract-details__table', 'aria-label': title }, [
        el('colgroup', {}, [el('col', { className: 'contract-details__label-column' }), el('col')]),
        el('thead', {}, [el('tr', {}, [el('th', { colspan: 2, scope: 'colgroup' }, [title])])]),
        el('tbody', {}, fields.map(([label, value]) => {
          const missing = value == null || String(value).trim() === '';
          return el('tr', {}, [
            el('th', { scope: 'row' }, [label]),
            el('td', { className: missing ? 'text-muted' : '' }, [missing ? 'No registrado' : String(value)])
          ]);
        }))
      ])
    ]);
  }

  function fact(icon, label, value) {
    return el('div', { className: 'contract-demo__fact' }, [lucideInlineIcon(icon, 'i'),
      el('div', {}, [el('span', { className: 'text-muted' }, [label]), el('div', { className: 'contract-demo__fact-value' }, [value])])]);
  }

  function contractProgress(contract) {
    const start = String(contract.fechaInicio || '').trim();
    const end = String(contract.fechaFin || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    const progress = today >= end ? 100 : today <= start ? 0
      : Math.max(0, Math.min(100, Math.round((dateAt(today) - dateAt(start)) / (dateAt(end) - dateAt(start)) * 100)));
    return el('span', { className: 'contract-demo__execution' }, [
      el('strong', {}, [`${progress} %`]), el('progress', { value: progress, max: 100, 'aria-label': 'Ejecucion temporal del contrato' })
    ]);
  }

  function render() {
    if (disposed) return;
    const currentVersion = ++version;
    const code = contractFilterCode();
    const contract = code ? contracts.find(item => String(item.codigo || '').trim() === code) : null;
    const heading = el('h2', {}, ['Datos del contrato']);
    if (status !== 'ready' || !contract) {
      const message = status === 'loading' ? 'Cargando contrato...' : status === 'error'
        ? 'No se pudo cargar la informacion del contrato.' : !code
          ? 'Selecciona un contrato en la barra lateral.' : 'El contrato seleccionado no esta disponible.';
      ui.replaceChildren(heading, el('p', { className: 'text-muted', role: 'status' }, [message]));
      return;
    }
    const image = el('div', { className: 'contract-details__image' }, [lucideInlineIcon('briefcase-business')]);
    const progress = contractProgress(contract);
    const children = [
      heading,
      el('div', { className: 'form-row contract-details__toolbar' }, [
      el('div', { className: 'contract-details__identity' }, [image,
        el('div', { className: 'contract-details__name' }, [
          el('h3', { className: 'section-title' }, [contract.nombre || contract.codigo]),
          el('p', { className: 'text-muted' }, [contract.clienteNombre || 'Cliente no registrado'])
        ]),
        el('span', { className: 'badge ' + (contract.estado === 'activo' ? 'badge--ok' : 'badge--off') }, [contract.estado === 'activo' ? 'Activo' : contract.estado === 'inactivo' ? 'Inactivo' : 'Sin estado'])
      ])])
    ];
    if (progress) children.push(el('div', { className: 'contract-demo__facts' }, [fact('chart-no-axes-combined', 'Ejecucion temporal', progress)]));
    children.push(el('div', { className: 'contract-details__tables' }, [section('Identificación y vigencia', [
        ['Código', contract.codigo], ['Número del contrato', contract.numeroContrato],
        ['Fecha de inicio', contract.fechaInicio], ['Fecha de finalización', contract.fechaFin]
      ]),
      section('Cliente', [['Nombre o razón social', contract.clienteNombre], ['NIT', contract.clienteNit]]),
      section('Contacto del cliente', [
        ['Nombre', contract.clienteContacto], ['Correo electrónico', contract.clienteEmail], ['Teléfono', contract.clienteTelefono]
      ])])
    );
    ui.replaceChildren(...children);
    if (contract.referenceImagePath && deps.getContractReferenceImageUrl) {
      Promise.resolve().then(() => deps.getContractReferenceImageUrl(contract.referenceImagePath)).then(url => {
        if (disposed || version !== currentVersion || !url) return;
        const img = el('img', { src: url, alt: 'Imagen de ' + (contract.nombre || contract.codigo) });
        img.addEventListener('error', () => img.replaceWith(lucideInlineIcon('briefcase-business')));
        image.replaceChildren(img);
      }).catch(() => {});
    }
  }

  const unSelected = subscribe('selectedContractCode', render);
  render();
  const un = deps.streamContracts?.(rows => {
    if (failedLoad) { failedLoad = false; return; }
    contracts = rows || [];
    status = 'ready';
    render();
  }, (_error, reason) => {
    if (reason !== 'LOAD_ERROR' && status === 'ready') return;
    failedLoad = reason === 'LOAD_ERROR';
    status = 'error';
    render();
  });
  if (!deps.streamContracts) { status = 'error'; render(); }
  return () => { disposed = true; un?.(); unSelected(); };
}
