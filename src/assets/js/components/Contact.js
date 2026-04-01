import { el } from '../utils/dom.js';

export const Contact = (mount) => {
  const section = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Contacto']),
    el('p', { className: 'text-muted mt-1' }, [
      'Canales oficiales de atencion para soporte y gestion del servicio.'
    ]),
    el('div', { className: 'contact-grid mt-2' }, [
      contactCard(
        'Capcol S.A.S.',
        [
          ['Pagina web', 'www.capcol.com.co', 'https://www.capcol.com.co'],
          ['Direccion', 'Calle 20 # 18-62, Caramanta, Antioquia, Colombia'],
          ['Telefono', '3502624742'],
          ['Correo', 'capcol@capcol.com.co', 'mailto:capcol@capcol.com.co']
        ]
      ),
      contactCard(
        'Servilimpieza S.A.',
        [
          ['Pagina web', 'oficial.servilimpieza.com.co', 'https://oficial.servilimpieza.com.co'],
          ['Direccion', 'Calle 86 D # 30 - 21, Bogota D.C'],
          ['Telefono', '601 628 6140'],
          ['Correo', 'servicioalcliente@servilimpieza.com.co', 'mailto:servicioalcliente@servilimpieza.com.co']
        ]
      )
    ])
  ]);

  mount.replaceChildren(section);
};

function contactCard(title, rows = []) {
  return el('article', { className: 'contact-card' }, [
    el('h3', { className: 'contact-card__title' }, [title]),
    ...rows.map(([label, value, href]) =>
      el('p', { className: 'contact-card__row' }, [
        el('strong', {}, [`${label}: `]),
        href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, [value]) : value
      ])
    )
  ]);
}
