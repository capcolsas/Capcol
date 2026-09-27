import { el } from '../utils/dom.js';
import { Footer } from './Footer.js';
import { Information } from './Information.js';
import { DataTreatment } from './DataTreatment.js';
import { About } from './About.js';
import { getState } from '../state.js';
export function mountPortalFooter(mountId, role) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  document.documentElement.dataset.theme = getState().theme;
  const footer = Footer({ role });
  const pages = { '#/information': Information, '#/data-treatment': DataTreatment, '#/about': About };
  footer.querySelectorAll('.footer-links a').forEach(link => {
    link.addEventListener('click', event => {
      const render = pages[link.getAttribute('href')];
      if (!render) return;
      event.preventDefault();
      const content = el('div');
      render(content);
      const close = el('button', { className: 'btn', type: 'button' }, ['Cerrar']);
      const dialog = el('dialog', { className: 'employee-info-dialog', 'aria-label': link.textContent }, [
        el('div', { className: 'employee-info-dialog__actions' }, [close]), content
      ]);
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { dialog.remove(); link.focus(); });
      document.body.append(dialog);
      dialog.showModal();
    });
  });
  mount.replaceChildren(footer);
}


