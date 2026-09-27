import { el, lucideInlineIcon } from '../../utils/dom.js';

export function summaryMetric(label, value, icon, tone, detail = '') {
  return el('article', { className: `contract-demo__metric is-${tone}` }, [
    el('span', { className: 'contract-demo__metric-label' }, [label]),
    el('div', { className: 'contract-demo__metric-value' }, [
      el('span', { className: `contract-demo__icon is-${tone}` }, [lucideInlineIcon(icon, 'i')]),
      el('strong', { className: 'metric-tile__value' }, [String(value ?? '-')])
    ]),
    ...(detail ? [el('span', { className: 'contract-demo__metric-detail' }, [detail])] : [])
  ]);
}

export function metricTile(label, value, tone = 'blue') {
  const colors = { blue: 'teal', indigo: 'blue', red: 'danger', lime: 'green' };
  const icon = /sede|contrato/i.test(label) ? 'building-2' : /carg|ruta|reporte/i.test(label) ? 'files' : /falta|novedad|incapac|inactiv/i.test(label) ? 'triangle-alert' : /planead/i.test(label) ? 'calendar-clock' : 'users';
  return summaryMetric(label, value, icon, colors[tone] || tone);
}

export function actionTile(action = {}) {
  const route = action.route || '/';
  const icon = /deliver/.test(route) ? 'truck' : /invent|product/.test(route) ? 'package' : /permiss|audit/.test(route) ? 'shield-check' : /employee|supervisor|user/.test(route) ? 'users' : /sede|contract|zone/.test(route) ? 'building-2' : 'clipboard-list';
  return el('a', { className: 'contract-demo__alert', href: `#${route}` }, [
    el('span', { className: 'contract-demo__icon is-teal' }, [lucideInlineIcon(icon, 'i')]),
    el('span', { className: 'contract-demo__alert-copy' }, [el('strong', {}, [action.label || 'Abrir módulo']), el('span', {}, [action.detail || ''])]),
    lucideInlineIcon('chevron-right', '>')
  ]);
}
