import { el, lucideInlineIcon } from '../utils/dom.js';
import { getRole } from '../permissions.js';
import { getState, setState } from '../state.js';

export const Footer = ({ role = getRole() } = {}) => {
  const themeBtn = el('button', { className: 'btn btn--icon footer-theme-btn', type: 'button' }, []);
  const syncTheme = () => {
    const dark = getState().theme === 'dark';
    themeBtn.replaceChildren(lucideInlineIcon(dark ? 'sun' : 'moon', dark ? '*' : '◐'));
    themeBtn.title = dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    themeBtn.setAttribute('aria-label', themeBtn.title);
  };
  syncTheme();
  themeBtn.addEventListener('click', () => {
    const theme = getState().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    setState({ theme });
    syncTheme();
  });
  return (
  el('div', { className: 'container footer-shell' }, [
    el('nav', { className: 'footer-links', 'aria-label': 'Informacion y contacto' }, [
      el('a', { href: '#/information' }, ['Información']),
      el('a', { href: '#/data-treatment' }, ['Tratamiento de Datos']),
      el('a', { href: '#/about' }, ['Acerca'])
    ]),
    el('div', { className: 'footer-meta' }, [
      el('div', { className: 'footer-actions' }, [
        el('span', { className: 'role-badge footer-role-badge', title: 'Rol actual' }, ['Rol: ', role || '-']),
        themeBtn
      ]),
      el('p', { className: 'text-muted footer-copy' }, [
        '© 2026 Rocky Soluciones de Capcol S.A.S.'
      ])
    ])
  ]));
};
