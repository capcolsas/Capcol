import { el } from '../utils/dom.js';

export const Information = (mount) => {
  mount.replaceChildren(el('section', { className: 'main-card' }, [
    el('h2', {}, ['Informacion']),
    el('section', { className: 'section-block' }, [
      el('h3', { className: 'section-title' }, ['Rocky Soluciones de Capcol S.A.S.']),
      el('p', { className: 'text-muted' }, ['Consultores en Administracion Publica Colombiana S.A.S.']),
      details([
        ['NIT', '900.939.656-7'],
        ['Direccion', 'Calle 20 # 18-62, Caramanta, Antioquia, Colombia'],
        ['Sitio web', 'www.capcol.com.co', 'https://www.capcol.com.co']
      ])
    ]),
    el('section', { className: 'section-block' }, [
      el('h3', { className: 'section-title' }, ['Contacto']),
      details([
        ['Telefono', '3502624742', 'tel:+573502624742'],
        ['Correo', 'capcol@capcol.com.co', 'mailto:capcol@capcol.com.co']
      ])
    ]),
    el('section', { className: 'section-block' }, [
      el('h3', { className: 'section-title' }, ['Soporte']),
      details([
        ['Telefono', '3502624743', 'tel:+573502624743'],
        ['Correo', 'soporte@capcol.com.co', 'mailto:soporte@capcol.com.co']
      ])
    ])
  ]));
};

function details(rows) {
  return el('dl', { className: 'information-details' }, rows.map(([label, value, href]) =>
    el('div', {}, [
      el('dt', {}, [label]),
      el('dd', {}, [href ? el('a', { href }, [value]) : value])
    ])
  ));
}
