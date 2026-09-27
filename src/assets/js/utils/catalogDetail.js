import { el } from './dom.js';
import { showInfoModal } from './infoModal.js';

export function detailDate(value) {
  try {
    if (value == null || value === '') return '-';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('es-CO') : '-';
  } catch { return '-'; }
}

export function detailSection(title, items = []) {
  return el('section', { className: 'employee-detail__section' }, [
    el('h4', { className: 'employee-detail__heading' }, [title]),
    el('dl', { className: 'employee-detail__grid' }, items.map(([label, value]) =>
      el('div', { className: 'employee-detail__item' }, [
        el('dt', {}, [label]),
        el('dd', {}, [value instanceof Node ? value : String(value ?? '').trim() || '-'])
      ])))
  ]);
}

export function showCatalogDetail(title, record, sections) {
  const modified = Boolean(record.lastModifiedAt || record.lastModifiedByEmail || record.lastModifiedByUid);
  showInfoModal(title, [el('div', { className: 'employee-detail' }, [
    ...sections.map(([heading, items]) => items instanceof Node
      ? el('section', { className: 'employee-detail__section' }, [
        el('h4', { className: 'employee-detail__heading' }, [heading]), items
      ])
      : detailSection(heading, items)),
    detailSection('Auditoria', [
      ['Evento', modified ? 'Ultima modificacion' : 'Creacion'],
      ['Usuario', modified ? record.lastModifiedByEmail || record.lastModifiedByUid : record.createdByEmail || record.createdByUid],
      ['Fecha evento', detailDate(modified ? record.lastModifiedAt : record.createdAt)],
      ['Creado por', record.createdByEmail || record.createdByUid],
      ['Fecha creacion', detailDate(record.createdAt)],
      ['Ultima modificacion por', record.lastModifiedByEmail || record.lastModifiedByUid],
      ['Fecha ultima modificacion', detailDate(record.lastModifiedAt)]
    ])
  ])]);
}
