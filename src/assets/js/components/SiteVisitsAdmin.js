import { el } from '../utils/dom.js';
import { subscribe } from '../state.js';
import { contractFilterCode } from '../utils/contractScope.js';
import { SiteVisits } from './SiteVisits.js';

export function SiteVisitsAdmin(mount, deps = {}) {
  const ui = el('section', { className: 'main-card' });
  let cleanup = null;
  let currentContract;
  mount.replaceChildren(ui);

  function render() {
    const contract = contractFilterCode();
    if (contract === currentContract) return;
    currentContract = contract;
    cleanup?.();
    cleanup = null;
    if (!contract) {
      ui.replaceChildren(
        el('h2', {}, ['Visitas']),
        el('p', { className: 'text-muted', role: 'status' }, ['Selecciona un contrato en la barra lateral para programar y consultar sus visitas.'])
      );
      return;
    }
    cleanup = SiteVisits(ui, deps, { contract, admin: true });
  }

  const unsubscribe = subscribe('selectedContractCode', render);
  render();
  return () => { unsubscribe(); cleanup?.(); };
}
