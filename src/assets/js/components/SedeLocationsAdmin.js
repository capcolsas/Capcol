import { el, lucideInlineIcon, qs } from '../utils/dom.js';
import { showActionModal } from '../utils/actionModal.js';
import {
  ensureLeaflet,
  googleMapsDirectionsUrl,
  hasValidSedeLocation,
  sedeCoordinates,
  sedeLocationLabel,
  wazeDirectionsUrl
} from '../utils/sedeLocation.js';
import { can, PERMS } from '../permissions.js';

const DEFAULT_CENTER = [4.570868, -74.297333];
const DEFAULT_OSM_EMBED_URL = 'https://www.openstreetmap.org/export/embed.html?bbox=-79.2%2C-4.5%2C-66.8%2C13.6&layer=mapnik&marker=4.570868%2C-74.297333';

export const SedeLocationsAdmin = (mount, deps = {}) => {
  const canEdit = can(PERMS.EDIT_SEDES);
  const ui = el('section', { className: 'main-card sede-location-page' }, [
    el('h2', {}, ['Ubicacion de sedes']),
    el('div', { className: 'sede-location-toolbar form-row' }, [
      field('Buscar', el('input', { id: 'sedeLocationSearch', className: 'input', placeholder: 'Codigo, nombre, zona o dependencia...' })),
      field('Zona', el('select', { id: 'sedeLocationZone', className: 'select' }, [el('option', { value: '' }, ['Todas'])])),
      field('Dependencia', el('select', { id: 'sedeLocationDependency', className: 'select' }, [el('option', { value: '' }, ['Todas'])])),
      field('Estado', el('select', { id: 'sedeLocationStatus', className: 'select' }, [
        el('option', { value: '' }, ['Todos']),
        el('option', { value: 'activo' }, ['Activos']),
        el('option', { value: 'inactivo' }, ['Inactivos'])
      ])),
      field('Ubicacion', el('select', { id: 'sedeLocationMode', className: 'select' }, [
        el('option', { value: '' }, ['Todas']),
        el('option', { value: 'located' }, ['Con ubicacion']),
        el('option', { value: 'missing' }, ['Sin ubicacion'])
      ]))
    ]),
    el('div', { className: 'sede-location-stats mt-2' }, [
      statTile('Ubicadas', '0', 'located'),
      statTile('Sin ubicacion', '0', 'missing'),
      statTile('Filtradas', '0', 'filtered')
    ]),
    el('section', { className: 'sede-location-map-panel mt-2' }, [
      el('div', { id: 'sedeLocationMap', className: 'sede-location-map', role: 'img', 'aria-label': 'Mapa de sedes' }, [
        fallbackOsmMapNode()
      ]),
      el('p', { id: 'sedeLocationMapMsg', className: 'text-muted sede-location-map-msg' }, ['Cargando mapa...'])
    ]),
    el('section', { className: 'section-block mt-2' }, [
      el('h3', { className: 'section-title' }, ['Sedes en mapa']),
      el('div', { className: 'responsive-records mt-1' }, [
        el('div', { className: 'table-wrap responsive-table-view' }, [
          el('table', { className: 'table', id: 'tblSedeLocations' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, ['Sede']),
              el('th', {}, ['Zona']),
              el('th', {}, ['Dependencia']),
              el('th', {}, ['Ubicacion']),
              el('th', {}, ['Estado']),
              el('th', {}, ['Acciones'])
            ])]),
            el('tbody', {})
          ])
        ]),
        el('div', { id: 'sedeLocationCards', className: 'record-card-list sede-location-list' }, [
          el('p', { className: 'text-muted record-card__empty' }, ['Sin sedes para mostrar.'])
        ])
      ])
    ]),
    el('section', { className: 'section-block mt-2' }, [
      el('h3', { className: 'section-title' }, ['Sedes sin ubicacion']),
      el('div', { className: 'responsive-records mt-1' }, [
        el('div', { className: 'table-wrap responsive-table-view' }, [
          el('table', { className: 'table', id: 'tblSedeLocationsMissing' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, ['Sede']),
              el('th', {}, ['Zona']),
              el('th', {}, ['Dependencia']),
              el('th', {}, ['Estado']),
              el('th', {}, ['Acciones'])
            ])]),
            el('tbody', {})
          ])
        ]),
        el('div', { id: 'sedeLocationMissingCards', className: 'record-card-list sede-location-missing-list' }, [
          el('p', { className: 'text-muted record-card__empty' }, ['Sin sedes pendientes.'])
        ])
      ])
    ])
  ]);

  let sedes = [];
  let zones = [];
  let dependencies = [];
  let disposed = false;
  let map = null;
  let markerLayer = null;
  const markerById = new Map();

  const searchInput = qs('#sedeLocationSearch', ui);
  const zoneSelect = qs('#sedeLocationZone', ui);
  const dependencySelect = qs('#sedeLocationDependency', ui);
  const statusSelect = qs('#sedeLocationStatus', ui);
  const modeSelect = qs('#sedeLocationMode', ui);
  const mapNode = qs('#sedeLocationMap', ui);
  const mapMsg = qs('#sedeLocationMapMsg', ui);
  const locatedBody = qs('#tblSedeLocations tbody', ui);
  const locatedCards = qs('#sedeLocationCards', ui);
  const missingBody = qs('#tblSedeLocationsMissing tbody', ui);
  const missingCards = qs('#sedeLocationMissingCards', ui);

  [searchInput, zoneSelect, dependencySelect, statusSelect, modeSelect].forEach((node) => {
    node?.addEventListener('input', render);
    node?.addEventListener('change', render);
  });

  mount.replaceChildren(ui);
  render();
  initMap();

  const unSedes = deps.streamSedes?.((rows) => {
    sedes = Array.isArray(rows) ? rows : [];
    syncFilterOptions();
    render();
  }) || (() => {});
  const unZones = deps.streamZones?.((rows) => {
    zones = Array.isArray(rows) ? rows : [];
    syncFilterOptions();
  }) || (() => {});
  const unDependencies = deps.streamDependencies?.((rows) => {
    dependencies = Array.isArray(rows) ? rows : [];
    syncFilterOptions();
  }) || (() => {});

  return () => {
    disposed = true;
    unSedes?.();
    unZones?.();
    unDependencies?.();
    if (map) {
      map.remove();
      map = null;
    }
  };

  function field(label, inputNode) {
    return el('div', {}, [
      el('label', { className: 'label' }, [label]),
      inputNode
    ]);
  }

  function statTile(label, value, key) {
    return el('div', { className: `sede-location-stat sede-location-stat--${key}` }, [
      el('span', { className: 'sede-location-stat__label' }, [label]),
      el('strong', { id: `sedeLocationStat${capitalize(key)}`, className: 'sede-location-stat__value' }, [value])
    ]);
  }

  function syncFilterOptions() {
    replaceOptions(zoneSelect, [{ value: '', label: 'Todas' }, ...catalogOptions(zones)]);
    replaceOptions(dependencySelect, [{ value: '', label: 'Todas' }, ...catalogOptions(dependencies)]);
    render();
  }

  function catalogOptions(rows = []) {
    return rows
      .filter((row) => String(row?.estado || 'activo') !== 'inactivo')
      .map((row) => ({ value: String(row.codigo || '').trim(), label: row.nombre ? `${row.nombre} (${row.codigo || '-'})` : String(row.codigo || '-') }))
      .filter((row) => row.value)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function replaceOptions(select, options = []) {
    if (!select) return;
    const current = String(select.value || '');
    select.replaceChildren(...options.map((option) => el('option', {
      value: option.value,
      selected: option.value === current
    }, [option.label])));
    if (options.some((option) => option.value === current)) select.value = current;
  }

  function render() {
    const rows = filteredSedes();
    const locatedRows = rows.filter((sede) => sedeCoordinates(sede));
    const missingRows = rows.filter((sede) => !sedeCoordinates(sede));
    setStat('Located', locatedRows.length);
    setStat('Missing', missingRows.length);
    setStat('Filtered', rows.length);
    renderLocatedList(locatedRows);
    renderMissingList(missingRows);
    renderMapMarkers(locatedRows);
  }

  function filteredSedes() {
    const term = normalize(searchInput?.value || '');
    const zone = String(zoneSelect?.value || '').trim();
    const dependency = String(dependencySelect?.value || '').trim();
    const status = String(statusSelect?.value || '').trim();
    const mode = String(modeSelect?.value || '').trim();
    return [...sedes]
      .filter((sede) => {
        const hasLocation = Boolean(sedeCoordinates(sede));
        if (mode === 'located' && !hasLocation) return false;
        if (mode === 'missing' && hasLocation) return false;
        if (zone && String(sede.zonaCodigo || '').trim() !== zone) return false;
        if (dependency && String(sede.dependenciaCodigo || '').trim() !== dependency) return false;
        if (status && String(sede.estado || '').trim() !== status) return false;
        if (!term) return true;
        const blob = [sede.codigo, sede.nombre, sede.zonaNombre, sede.zonaCodigo, sede.dependenciaNombre, sede.dependenciaCodigo].join(' ');
        return normalize(blob).includes(term);
      })
      .sort((a, b) => String(a.nombre || a.codigo || '').localeCompare(String(b.nombre || b.codigo || '')));
  }

  function renderLocatedList(rows = []) {
    locatedBody.replaceChildren(...(rows.length ? rows.map((sede) => sedeLocationRow(sede)) : [
      el('tr', {}, [el('td', { colSpan: 6, className: 'text-muted' }, ['Sin sedes ubicadas para estos filtros.'])])
    ]));
    locatedCards.replaceChildren(...(rows.length ? rows.map((sede) => sedeLocationCard(sede)) : [
      el('p', { className: 'text-muted record-card__empty' }, ['Sin sedes ubicadas para estos filtros.'])
    ]));
  }

  function renderMissingList(rows = []) {
    missingBody.replaceChildren(...(rows.length ? rows.map((sede) => missingSedeRow(sede)) : [
      el('tr', {}, [el('td', { colSpan: 5, className: 'text-muted' }, ['Sin sedes pendientes.'])])
    ]));
    missingCards.replaceChildren(...(rows.length ? rows.map((sede) => missingSedeCard(sede)) : [
      el('p', { className: 'text-muted record-card__empty' }, ['Sin sedes pendientes.'])
    ]));
  }

  function sedeLocationRow(sede) {
    const coords = sedeCoordinates(sede);
    return el('tr', {}, [
      el('td', {}, [sedeNameNode(sede)]),
      el('td', {}, [sede.zonaNombre || sede.zonaCodigo || '-']),
      el('td', {}, [sede.dependenciaNombre || sede.dependenciaCodigo || '-']),
      el('td', {}, [sedeLocationLabel(sede)]),
      el('td', {}, [statusBadge(sede)]),
      el('td', {}, [el('div', { className: 'row-actions' }, [focusButton(sede), ...mapActions(coords), editButton(sede)])])
    ]);
  }

  function sedeLocationCard(sede) {
    const coords = sedeCoordinates(sede);
    const actions = mapActions(coords);
    const card = el('article', { className: 'record-card sede-location-card' }, [
      el('div', { className: 'record-card__header' }, [
        el('div', { className: 'record-card__identity' }, [
          el('strong', { className: 'record-card__title' }, [sede.nombre || '-']),
          el('span', { className: 'record-card__subtitle' }, [`${sede.codigo || '-'} · ${sede.zonaNombre || sede.zonaCodigo || 'Sin zona'}`])
        ]),
        el('span', { className: `badge ${String(sede.estado || 'activo') === 'activo' ? 'badge--ok' : 'badge--off'}` }, [sede.estado || '-'])
      ]),
      el('dl', { className: 'record-card__meta' }, [
        ['Dependencia', sede.dependenciaNombre || sede.dependenciaCodigo || '-'],
        ['Ubicacion', sedeLocationLabel(sede)]
      ].map(([label, value]) => metaItem(label, value))),
      el('div', { className: 'record-card__actions' }, [
        focusButton(sede),
        ...actions,
        editButton(sede)
      ])
    ]);
    card.addEventListener('dblclick', () => focusSede(sede));
    return card;
  }

  function missingSedeRow(sede) {
    return el('tr', {}, [
      el('td', {}, [sedeNameNode(sede)]),
      el('td', {}, [sede.zonaNombre || sede.zonaCodigo || '-']),
      el('td', {}, [sede.dependenciaNombre || sede.dependenciaCodigo || '-']),
      el('td', {}, [statusBadge(sede)]),
      el('td', {}, [missingSedeActions(sede)])
    ]);
  }

  function missingSedeCard(sede) {
    return el('article', { className: 'sede-location-missing' }, [
      el('div', {}, [
        el('strong', {}, [sede.nombre || '-']),
        el('span', { className: 'text-muted' }, [`${sede.codigo || '-'} · ${sede.zonaNombre || sede.zonaCodigo || 'Sin zona'}`])
      ]),
      el('div', { className: 'sede-location-missing__actions row-actions' }, [
        disabledMapButton('Google Maps'),
        disabledMapButton('Waze'),
        editButton(sede)
      ])
    ]);
  }

  function missingSedeActions(sede) {
    return el('div', { className: 'row-actions sede-location-missing__actions' }, [
      disabledMapButton('Google Maps'),
      disabledMapButton('Waze'),
      editButton(sede)
    ]);
  }

  function editButton(sede) {
    const btn = el('button', { className: 'btn btn--icon', type: 'button', title: 'Editar sede', 'aria-label': 'Editar sede' }, [
      lucideInlineIcon('pencil', 'Ed')
    ]);
    if (!canEdit) {
      btn.disabled = true;
      btn.title = 'No tienes permiso para editar sedes';
      btn.setAttribute('aria-label', 'No tienes permiso para editar sedes');
      return btn;
    }
    btn.addEventListener('click', () => openEditSedeModal(sede));
    return btn;
  }

  function sedeNameNode(sede) {
    return el('div', { className: 'sede-location-name' }, [
      el('strong', {}, [sede.nombre || '-']),
      el('span', { className: 'text-muted' }, [sede.codigo || '-'])
    ]);
  }

  function statusBadge(sede) {
    return el('span', { className: `badge ${String(sede.estado || 'activo') === 'activo' ? 'badge--ok' : 'badge--off'}` }, [sede.estado || '-']);
  }

  function focusButton(sede) {
    const btn = el('button', { className: 'btn btn--icon', type: 'button', title: 'Ver en mapa', 'aria-label': 'Ver en mapa' }, [
      lucideInlineIcon('map-pin', 'U')
    ]);
    btn.addEventListener('click', () => focusSede(sede));
    return btn;
  }

  function mapActions(coords) {
    if (!coords) return [];
    return [
      el('a', {
        className: 'btn btn--icon',
        href: googleMapsDirectionsUrl(coords.latitude, coords.longitude),
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'Abrir en Google Maps',
        'aria-label': 'Abrir en Google Maps'
      }, [lucideInlineIcon('map', 'G')]),
      el('a', {
        className: 'btn btn--icon',
        href: wazeDirectionsUrl(coords.latitude, coords.longitude),
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'Abrir en Waze',
        'aria-label': 'Abrir en Waze'
      }, [lucideInlineIcon('navigation', 'W')])
    ];
  }

  function disabledMapButton(label) {
    const icon = label === 'Waze' ? 'navigation' : 'map';
    const fallback = label === 'Waze' ? 'W' : 'G';
    return el('button', {
      className: 'btn btn--icon',
      type: 'button',
      disabled: true,
      title: `Registra ubicacion de sede para abrir en ${label}`,
      'aria-label': `Registra ubicacion de sede para abrir en ${label}`
    }, [lucideInlineIcon(icon, fallback)]);
  }

  async function initMap() {
    try {
      const L = await ensureLeaflet();
      if (disposed || !mapNode) return;
      mapNode.replaceChildren();
      map = L.map(mapNode, {
        center: DEFAULT_CENTER,
        zoom: 5,
        scrollWheelZoom: true
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      markerLayer = L.layerGroup().addTo(map);
      mapMsg.textContent = ' ';
      setTimeout(() => map?.invalidateSize(), 150);
      renderMapMarkers(filteredSedes().filter((sede) => sedeCoordinates(sede)));
    } catch (error) {
      console.warn('No se pudo cargar el mapa de sedes:', error);
      if (mapMsg) mapMsg.textContent = 'Mapa gratuito OpenStreetMap en modo basico. Los enlaces de navegacion siguen disponibles.';
    }
  }

  function fallbackOsmMapNode() {
    return el('iframe', {
      className: 'sede-location-map__fallback',
      src: DEFAULT_OSM_EMBED_URL,
      title: 'Mapa gratuito OpenStreetMap',
      loading: 'lazy'
    }, []);
  }

  function renderMapMarkers(rows = []) {
    if (!map || !markerLayer || !globalThis.L) return;
    const L = globalThis.L;
    markerLayer.clearLayers();
    markerById.clear();
    const bounds = [];
    rows.forEach((sede) => {
      const coords = sedeCoordinates(sede);
      if (!coords) return;
      const marker = L.marker([coords.latitude, coords.longitude]);
      marker.bindPopup(popupContent(sede));
      marker.addTo(markerLayer);
      markerById.set(String(sede.id || sede.codigo || ''), marker);
      bounds.push([coords.latitude, coords.longitude]);
    });
    if (!bounds.length) {
      map.setView(DEFAULT_CENTER, 5);
      if (mapMsg) mapMsg.textContent = 'Sin sedes ubicadas para estos filtros.';
      return;
    }
    if (mapMsg) mapMsg.textContent = ' ';
    if (bounds.length === 1) map.setView(bounds[0], 15);
    else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  }

  function popupContent(sede) {
    const coords = sedeCoordinates(sede);
    return el('div', { className: 'sede-location-popup' }, [
      el('strong', {}, [sede.nombre || '-']),
      el('span', {}, [sede.codigo || '-']),
      el('span', {}, [sede.zonaNombre || sede.zonaCodigo || 'Sin zona']),
      el('span', {}, [sedeLocationLabel(sede)]),
      el('div', { className: 'sede-location-popup__actions' }, [...mapActions(coords), editButton(sede)])
    ]);
  }

  function focusSede(sede = {}) {
    const coords = sedeCoordinates(sede);
    if (!coords || !map) return;
    map.setView([coords.latitude, coords.longitude], Math.max(map.getZoom() || 15, 15));
    const marker = markerById.get(String(sede.id || sede.codigo || ''));
    marker?.openPopup();
  }

  function metaItem(label, value) {
    return el('div', { className: 'record-card__meta-item' }, [
      el('dt', {}, [label]),
      el('dd', {}, [value || '-'])
    ]);
  }

  async function openEditSedeModal(sede = {}) {
    const modal = await showActionModal({
      title: 'Editar sede',
      message: `Sede: ${sede.nombre || '-'}`,
      confirmText: 'Guardar cambios',
      fields: [
        { id: 'codigo', label: 'Codigo', type: 'text', required: true, value: sede.codigo || '' },
        { id: 'nombre', label: 'Nombre', type: 'text', required: true, value: sede.nombre || '' },
        { id: 'dependencia', label: 'Dependencia', type: 'datalist', required: true, placeholder: 'Selecciona o escribe dependencia', value: labelByCode(dependencies, sede.dependenciaCodigo || ''), options:catalogDatalistOptions(dependencies) },
        { id: 'zona', label: 'Zona', type: 'datalist', required: true, placeholder: 'Selecciona o escribe zona', value: labelByCode(zones, sede.zonaCodigo || ''), options:catalogDatalistOptions(zones) },
        { id: 'numeroOperarios', label: 'Nro de operarios', type: 'number', required: true, min: '0', step: '1', value: String(sede.numeroOperarios ?? '') },
        {
          id: 'jornada',
          label: 'Jornada',
          type: 'select',
          value: sede.jornada || 'lun_vie',
          options: [
            { value: 'lun_vie', label: 'Lunes a viernes' },
            { value: 'lun_sab', label: 'Lunes a sabado' },
            { value: 'lun_dom', label: 'Lunes a domingo' }
          ]
        },
        {
          id: 'qrEnabled',
          label: 'QR',
          type: 'select',
          value: sede.qrEnabled === true ? 'true' : 'false',
          options: [
            { value: 'false', label: 'Inactivo' },
            { value: 'true', label: 'Activo' }
          ]
        },
        { id: 'qrLatitude', label: 'Latitud sede', type: 'number', step: '0.000001', value: sede.qrLatitude ?? '', placeholder: 'Ej: 6.244203' },
        { id: 'qrLongitude', label: 'Longitud sede', type: 'number', step: '0.000001', value: sede.qrLongitude ?? '', placeholder: 'Ej: -75.581212' },
        { id: 'qrRadiusMeters', label: 'Radio validacion QR (m)', type: 'number', min: '1', step: '1', value: String(sede.qrRadiusMeters || 500) },
        { id: 'detail', label: 'Detalle de la modificacion', type: 'textarea', required: true, placeholder: 'Describe brevemente el cambio realizado' }
      ]
    });
    if (!modal.confirmed) return;
    const newCode = String(modal.values.codigo || '').trim();
    const newName = String(modal.values.nombre || '').trim();
    const newDepCode = resolveCode(dependencies, modal.values.dependencia);
    const newZoneCode = resolveCode(zones, modal.values.zona);
    const newOpsRaw = String(modal.values.numeroOperarios || '').trim();
    const newJornada = String(modal.values.jornada || 'lun_vie').trim() || 'lun_vie';
    const newQrEnabled = String(modal.values.qrEnabled || 'false') === 'true';
    const newQrLatitude = parseOptionalNumber(modal.values.qrLatitude);
    const newQrLongitude = parseOptionalNumber(modal.values.qrLongitude);
    const newQrRadiusMeters = parsePositiveInteger(modal.values.qrRadiusMeters, 500);
    if (!newCode || !newName) return alert('Completa codigo y nombre.');
    if (!newDepCode || !newZoneCode) return alert('Selecciona dependencia y zona.');
    const newOps = Number(newOpsRaw);
    if (!Number.isFinite(newOps) || newOps < 0 || !Number.isInteger(newOps)) return alert('Ingresa un numero entero de operarios valido.');
    if ((newQrLatitude !== null || newQrLongitude !== null) && !hasValidSedeLocation(newQrLatitude, newQrLongitude)) return alert('Registra una ubicacion valida de la sede.');
    if (newQrEnabled && !hasValidSedeLocation(newQrLatitude, newQrLongitude)) return alert('Para activar QR debes registrar una ubicacion valida de la sede.');
    try {
      if (newCode !== sede.codigo) {
        const duplicate = await deps.findSedeByCode?.(newCode);
        if (duplicate && duplicate.id !== sede.id) return alert('Ya existe una sede con ese codigo.');
      }
      const newDep = dependencies.find((row) => row.codigo === newDepCode);
      const newZone = zones.find((row) => row.codigo === newZoneCode);
      await deps.updateSede?.(sede.id, {
        codigo: newCode,
        nombre: newName,
        dependenciaCodigo: newDepCode,
        dependenciaNombre: newDep?.nombre || null,
        zonaCodigo: newZoneCode,
        zonaNombre: newZone?.nombre || null,
        numeroOperarios: newOps,
        jornada: newJornada,
        qrEnabled: newQrEnabled,
        qrLatitude: newQrLatitude,
        qrLongitude: newQrLongitude,
        qrRadiusMeters: newQrRadiusMeters
      });
      await deps.addAuditLog?.({
        targetType: 'sede',
        targetId: sede.id,
        action: 'update_sede',
        before: {
          codigo: sede.codigo,
          nombre: sede.nombre,
          dependenciaCodigo: sede.dependenciaCodigo,
          zonaCodigo: sede.zonaCodigo,
          numeroOperarios: sede.numeroOperarios,
          jornada: sede.jornada || 'lun_vie',
          qrEnabled: sede.qrEnabled === true,
          qrLatitude: sede.qrLatitude,
          qrLongitude: sede.qrLongitude,
          qrRadiusMeters: sede.qrRadiusMeters
        },
        after: {
          codigo: newCode,
          nombre: newName,
          dependenciaCodigo: newDepCode,
          zonaCodigo: newZoneCode,
          numeroOperarios: newOps,
          jornada: newJornada,
          qrEnabled: newQrEnabled,
          qrLatitude: newQrLatitude,
          qrLongitude: newQrLongitude,
          qrRadiusMeters: newQrRadiusMeters
        },
        note: modal.values.detail || null
      });
    } catch (error) {
      alert('Error: ' + (error?.message || error));
    }
  }

  function labelByCode(rows = [], code) {
    const item = rows.find((row) => row.codigo === code);
    return item ? `${item.nombre || item.codigo} (${item.codigo || '-'})` : '';
  }

  function catalogDatalistOptions(rows = []) {
    return rows
      .map((row) => labelByCode(rows, row.codigo))
      .filter((value, index, arr) => value && arr.indexOf(value) === index);
  }

  function resolveCode(rows = [], rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';
    const byCode = rows.find((row) => String(row.codigo || '').toLowerCase() === raw.toLowerCase());
    if (byCode) return byCode.codigo;
    const match = raw.match(/\(([^)]+)\)\s*$/);
    if (match) {
      const code = match[1].trim();
      const byLabel = rows.find((row) => String(row.codigo || '').toLowerCase() === code.toLowerCase());
      if (byLabel) return byLabel.codigo;
    }
    const byName = rows.find((row) => String(row.nombre || '').toLowerCase() === raw.toLowerCase());
    return byName?.codigo || '';
  }

  function parseOptionalNumber(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function parsePositiveInteger(value, fallback) {
    const n = Number(String(value || '').trim());
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : fallback;
  }

  function setStat(key, value) {
    const node = qs(`#sedeLocationStat${key}`, ui);
    if (node) node.textContent = String(value || 0);
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function capitalize(value) {
    const text = String(value || '');
    return text ? text.slice(0, 1).toUpperCase() + text.slice(1) : '';
  }
};
