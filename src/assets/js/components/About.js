import { el } from '../utils/dom.js';

export const About = (mount) => {
  mount.replaceChildren(
    el('section', { className: 'main-card' }, [
      el('h2', {}, ['Acerca de Capcol RockyDEMO']),
      el('p', { className: 'text-muted mt-1' }, [
        'Plataforma de gestion operativa y administrativa para el seguimiento de servicios, personal y novedades.'
      ]),
      el('div', { className: 'contact-grid mt-2' }, [
        el('article', { className: 'contact-card' }, [
          el('h3', { className: 'contact-card__title' }, ['Informacion corporativa']),
          el('p', { className: 'contact-card__row' }, [el('strong', {}, ['Version: ']), 'Capcol RockyDEMO v2.1.1']),
          el('p', { className: 'contact-card__row' }, [el('strong', {}, ['Estado: ']), 'Pendiente de parametrizacion para la nueva operacion']),
          el('p', { className: 'contact-card__row' }, [el('strong', {}, ['Titularidad: ']), 'Definir con la nueva cuenta']),
          el('p', { className: 'contact-card__row' }, [el('strong', {}, ['Derechos: ']), 'Configuracion en proceso'])
        ]),
        el('article', { className: 'contact-card' }, [
          el('h3', { className: 'contact-card__title' }, ['Canales de contacto']),
          el('p', { className: 'contact-card__row' }, [el('strong', {}, ['Administrador: ']), 'Pendiente']),
          el('p', { className: 'contact-card__row' }, [el('strong', {}, ['Correo: ']), 'Definir en la nueva cuenta']),
          el('p', { className: 'contact-card__row' }, [el('strong', {}, ['Telefono: ']), 'Definir en la nueva cuenta']),
          el('p', { className: 'contact-card__row mt-2' }, [el('strong', {}, ['Soporte: ']), 'Actualiza este bloque antes de produccion'])
        ])
      ])
    ])
  );
};
