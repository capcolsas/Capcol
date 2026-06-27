import { Login } from './components/Login.js';
import { el, qs } from './utils/dom.js';
import { installBrowserAlertReplacement } from './utils/notifications.js';
import { ROLES } from './roles.js';

installBrowserAlertReplacement();

const root = document.getElementById('supervisor-root');
let deps = {};
let currentUser = null;
let currentProfile = null;
let currentRegistry = emptyRegistry(todayBogota());
let activeTab = 'home';
let selectedDate = todayBogota();
let searchText = '';
let statusFilter = 'all';
let sedeFilter = 'all';
let loading = false;
let lastLoadedAt = null;

function emptyRegistry(fecha) {
  return {
    fecha,
    zones: [],
    sedes: [],
    employees: [],
    dailyStatus: [],
    attendance: [],
    replacements: [],
    closures: []
  };
}

(async function init() {
  try {
    const fb = await import('./supabase.js');
    deps = {
      authState: fb.authState,
      login: fb.login,
      register: fb.register,
      logout: fb.logout,
      ensureUserProfile: fb.ensureUserProfile,
      loadUserProfile: fb.loadUserProfile,
      createUserProfile: fb.createUserProfile,
      listSupervisorDailyRegistry: fb.listSupervisorDailyRegistry
    };
    deps.authState(handleAuthState);
  } catch (error) {
    renderFatal(`No se pudo iniciar la app de supervisores: ${error?.message || error}`);
  }
})();

async function handleAuthState(user) {
  currentUser = user || null;
  if (!user) {
    currentProfile = null;
    renderLogin();
    return;
  }
  try {
    await deps.ensureUserProfile?.(user);
    const profile = await deps.loadUserProfile?.(user.uid);
    currentProfile = profile || null;
    const status = String(profile?.estado || 'activo').toLowerCase();
    if (status === 'inactivo' || status === 'eliminado') {
      try {
        sessionStorage.setItem('auth_block_msg', status === 'eliminado' ? 'Tu usuario fue eliminado. Contacta al administrador.' : 'Tu usuario esta inactivo. Contacta al administrador.');
      } catch {}
      await deps.logout?.();
      return;
    }
    if (String(profile?.role || '').toLowerCase() === ROLES.TABLET_QR) {
      window.location.replace('qr.html');
      return;
    }
    if (!canUseSupervisorApp(profile)) {
      renderDenied(profile);
      return;
    }
    await loadRegistry();
  } catch (error) {
    renderFatal(`No se pudo validar tu acceso: ${error?.message || error}`);
  }
}

function canUseSupervisorApp(profile = {}) {
  const role = String(profile?.role || '').toLowerCase();
  if (role === ROLES.SUPERADMIN || role === ROLES.ADMIN) return true;
  return role === ROLES.SUPERVISOR && profile?.supervisorEligible === true;
}

function supervisorZones(profile = currentProfile) {
  const zones = [
    ...(Array.isArray(profile?.zonasPermitidas) ? profile.zonasPermitidas : []),
    profile?.zonaCodigo
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(zones)];
}

async function loadRegistry() {
  loading = true;
  renderApp();
  try {
    const zones = supervisorZones();
    currentRegistry = await deps.listSupervisorDailyRegistry?.(selectedDate, zones) || emptyRegistry(selectedDate);
    lastLoadedAt = new Date();
  } catch (error) {
    currentRegistry = { ...emptyRegistry(selectedDate), error: error?.message || String(error) };
  } finally {
    loading = false;
    renderApp();
  }
}

function renderLogin() {
  const shell = el('section', { className: 'supervisor-login' }, [
    el('div', { className: 'supervisor-login__inner' }, [
      el('div', { className: 'supervisor-login__brand' }, [
        el('img', { src: 'src/assets/img/rocky-logo.png', alt: 'Rocky' }),
        el('div', {}, [
          el('h1', {}, ['Supervisores']),
          el('p', {}, ['Registro diario por zona'])
        ])
      ]),
      el('div', { id: 'supervisor-login-mount' })
    ])
  ]);
  root.replaceChildren(shell);
  Login(qs('#supervisor-login-mount', shell), deps);
}

function renderDenied(profile = {}) {
  root.replaceChildren(el('section', { className: 'supervisor-denied' }, [
    el('article', { className: 'supervisor-denied__card' }, [
      el('h1', {}, ['Acceso de supervisores']),
      el('p', {}, ['Este ingreso esta reservado para usuarios supervisores activos y habilitados.']),
      el('p', {}, [`Usuario: ${profile?.email || currentUser?.email || '-'}`]),
      el('div', { className: 'supervisor-card__actions' }, [
        actionButton('Administrativo', () => { window.location.href = 'app.html#/login'; }),
        actionButton('Salir', async () => { await deps.logout?.(); }, true)
      ])
    ])
  ]));
}

function renderFatal(message) {
  root.replaceChildren(el('section', { className: 'supervisor-denied' }, [
    el('article', { className: 'supervisor-denied__card' }, [
      el('h1', {}, ['Rocky Supervisores']),
      el('p', {}, [message])
    ])
  ]));
}

function renderApp() {
  if (!currentUser || !currentProfile) return;
  const rows = buildRegistryRows();
  const filteredRows = filterRows(rows);
  const noveltyRows = rows.filter((row) => row.hasNovelty || row.status === 'ausente');
  const summary = summarizeRows(rows);
  const zoneLabel = supervisorZones().join(', ') || 'Sin zona';

  const app = el('div', { className: 'supervisor-app' }, [
    el('header', { className: 'supervisor-topbar' }, [
      el('div', { className: 'supervisor-brand' }, [
        el('img', { className: 'supervisor-brand__logo', src: 'src/assets/img/rocky-logo.png', alt: 'Rocky' }),
        el('div', { className: 'supervisor-brand__copy' }, [
          el('span', { className: 'supervisor-brand__eyebrow' }, ['Rocky']),
          el('strong', { className: 'supervisor-brand__name' }, [displayName()])
        ])
      ]),
      el('span', { className: 'supervisor-zone-pill', title: zoneLabel }, [zoneLabel])
    ]),
    el('main', { className: 'supervisor-main' }, [
      panel('home', [
        hero(summary),
        kpiGrid(summary),
        sectionHead('Pendientes prioritarios', `${pendingRows(rows).length} pendientes`),
        listOrEmpty(pendingRows(rows).slice(0, 6), 'No hay pendientes para mostrar.')
      ]),
      panel('registry', [
        hero(summary, true),
        toolbar(),
        sectionHead('Registro diario', `${filteredRows.length} registros`),
        listOrEmpty(filteredRows, 'No hay registros con los filtros actuales.')
      ]),
      panel('novelties', [
        hero(summary, true),
        sectionHead('Novedades y ausencias', `${noveltyRows.length} registros`),
        listOrEmpty(noveltyRows, 'No hay novedades registradas para esta fecha.')
      ]),
      panel('profile', [
        profilePanel(summary)
      ])
    ]),
    bottomNav()
  ]);
  root.replaceChildren(app);
}

function panel(name, children) {
  return el('section', { className: `supervisor-panel${activeTab === name ? ' is-active' : ''}`, dataset: { panel: name } }, children);
}

function hero(summary, compact = false) {
  return el('section', { className: 'supervisor-hero' }, [
    el('div', { className: 'supervisor-hero__top' }, [
      el('div', {}, [
        el('h1', { className: 'supervisor-title' }, [compact ? 'Registro diario' : 'Hoy en tu zona']),
        el('p', { className: 'supervisor-subtitle' }, [currentRegistry.error ? `Error: ${currentRegistry.error}` : summaryLabel(summary)])
      ]),
      el('div', { className: 'supervisor-date' }, [
        el('label', { for: 'supervisorDate' }, ['Fecha']),
        el('input', { id: 'supervisorDate', className: 'input', type: 'date', value: selectedDate, onchange: (event) => {
          selectedDate = event.target.value || todayBogota();
          loadRegistry();
        } })
      ])
    ]),
    el('div', { className: 'supervisor-sync' }, [
      el('span', {}, [loading ? 'Actualizando datos...' : lastLoadedAt ? `Actualizado ${formatTime(lastLoadedAt)}` : 'Listo para actualizar']),
      el('button', { className: 'btn supervisor-refresh', type: 'button', onclick: loadRegistry }, ['Actualizar'])
    ])
  ]);
}

function kpiGrid(summary) {
  return el('section', { className: 'supervisor-kpis' }, [
    kpi('Esperados', summary.expected, 'info'),
    kpi('Presentes', summary.present, 'ok'),
    kpi('Pendientes', summary.pending, 'warn'),
    kpi('Novedades', summary.novelties, 'danger')
  ]);
}

function kpi(label, value, tone) {
  return el('article', { className: `supervisor-kpi supervisor-kpi--${tone}` }, [
    el('span', { className: 'supervisor-kpi__label' }, [label]),
    el('strong', { className: 'supervisor-kpi__value' }, [String(value)])
  ]);
}

function toolbar() {
  const sedes = [...new Set(buildRegistryRows().map((row) => row.sedeNombre).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return el('section', { className: 'supervisor-toolbar' }, [
    el('input', {
      id: 'supervisorSearch',
      className: 'input',
      placeholder: 'Buscar nombre, documento o sede',
      value: searchText,
      oninput: (event) => {
        searchText = event.target.value || '';
        renderApp();
      }
    }),
    el('div', { className: 'supervisor-filter-row' }, [
      el('select', { className: 'select', value: statusFilter, onchange: (event) => {
        statusFilter = event.target.value || 'all';
        renderApp();
      } }, [
        option('all', 'Todos', statusFilter),
        option('presente', 'Presentes', statusFilter),
        option('pendiente', 'Pendientes', statusFilter),
        option('novedad', 'Novedades', statusFilter),
        option('ausente', 'Ausentes', statusFilter)
      ]),
      el('select', { className: 'select', value: sedeFilter, onchange: (event) => {
        sedeFilter = event.target.value || 'all';
        renderApp();
      } }, [
        option('all', 'Todas las sedes', sedeFilter),
        ...sedes.map((sede) => option(sede, sede, sedeFilter))
      ])
    ])
  ]);
}

function option(value, label, selected) {
  return el('option', { value, selected: value === selected }, [label]);
}

function sectionHead(title, count) {
  return el('div', { className: 'supervisor-section-head' }, [
    el('h2', {}, [title]),
    el('span', { className: 'supervisor-count' }, [count])
  ]);
}

function listOrEmpty(rows, emptyText) {
  if (!rows.length) return el('p', { className: 'supervisor-empty' }, [emptyText]);
  return el('div', { className: 'supervisor-list' }, rows.map(recordCard));
}

function recordCard(row) {
  const phone = normalizePhone(row.telefono);
  return el('article', { className: 'supervisor-card' }, [
    el('div', { className: 'supervisor-card__main' }, [
      el('div', {}, [
        el('h3', { className: 'supervisor-card__name' }, [row.nombre || 'Sin nombre']),
        el('p', { className: 'supervisor-card__meta' }, [`${row.documento || '-'} · ${row.sedeNombre || 'Sin sede'}`])
      ]),
      statusBadge(row)
    ]),
    el('div', { className: 'supervisor-card__details' }, [
      detail('Hora', row.hora || '-'),
      detail('Novedad', row.novedad || row.estadoDia || '-'),
      detail('Zona', row.zonaNombre || row.zonaCodigo || '-'),
      detail('Cobertura', row.reemplazo || row.decisionCobertura || '-')
    ]),
    el('div', { className: 'supervisor-card__actions' }, [
      phone ? linkAction('Llamar', `tel:${phone}`) : null,
      phone ? linkAction('WhatsApp', `https://wa.me/${phone}`) : null
    ].filter(Boolean))
  ]);
}

function detail(label, value) {
  return el('div', { className: 'supervisor-detail' }, [
    el('span', {}, [label]),
    el('strong', {}, [String(value || '-')])
  ]);
}

function statusBadge(row) {
  const labels = {
    presente: 'Presente',
    pendiente: 'Pendiente',
    novedad: 'Novedad',
    ausente: 'Ausente',
    neutral: 'Sin estado'
  };
  return el('span', { className: `supervisor-status supervisor-status--${row.status || 'neutral'}` }, [labels[row.status] || labels.neutral]);
}

function linkAction(label, href) {
  return el('a', { className: 'btn supervisor-action', href, target: href.startsWith('http') ? '_blank' : undefined, rel: href.startsWith('http') ? 'noopener' : undefined }, [label]);
}

function actionButton(label, onClick, primary = false) {
  return el('button', { className: `btn supervisor-action${primary ? ' btn--primary' : ''}`, type: 'button', onclick: onClick }, [label]);
}

function bottomNav() {
  const items = [
    ['home', 'Inicio'],
    ['registry', 'Registros'],
    ['novelties', 'Novedades'],
    ['profile', 'Perfil']
  ];
  return el('nav', { className: 'supervisor-bottom-nav', 'aria-label': 'Navegacion supervisores' }, items.map(([key, label]) => (
    el('button', {
      className: `supervisor-nav-btn${activeTab === key ? ' is-active' : ''}`,
      type: 'button',
      onclick: () => {
        activeTab = key;
        renderApp();
      }
    }, [label])
  )));
}

function profilePanel(summary) {
  const zones = supervisorZones();
  return el('section', { className: 'supervisor-hero' }, [
    el('h1', { className: 'supervisor-title' }, ['Perfil']),
    el('p', { className: 'supervisor-subtitle' }, [currentProfile?.email || currentUser?.email || '-']),
    kpiGrid(summary),
    el('div', { className: 'supervisor-card__details' }, [
      detail('Rol', currentProfile?.role || '-'),
      detail('Zonas', zones.join(', ') || 'Sin zonas asignadas'),
      detail('Estado', currentProfile?.estado || 'activo'),
      detail('Fecha', selectedDate)
    ]),
    el('div', { className: 'supervisor-card__actions' }, [
      actionButton('Administrativo', () => { window.location.href = 'app.html#/login'; }),
      actionButton('Cerrar sesion', async () => { await deps.logout?.(); }, true)
    ])
  ]);
}

function buildRegistryRows() {
  const registry = currentRegistry || emptyRegistry(selectedDate);
  const employeesByDoc = new Map((registry.employees || []).map((emp) => [String(emp.documento || '').trim(), emp]));
  const employeesById = new Map((registry.employees || []).map((emp) => [String(emp.id || '').trim(), emp]));
  const attendanceByDoc = new Map();
  const attendanceByEmployee = new Map();
  (registry.attendance || []).forEach((row) => {
    if (row.documento) attendanceByDoc.set(String(row.documento).trim(), row);
    if (row.empleadoId) attendanceByEmployee.set(String(row.empleadoId).trim(), row);
  });
  const replacementByDoc = new Map((registry.replacements || []).map((row) => [String(row.documento || '').trim(), row]));
  const rows = [];

  (registry.dailyStatus || []).forEach((status) => {
    const doc = String(status.documento || '').trim();
    const employee = employeesByDoc.get(doc) || employeesById.get(String(status.employeeId || '').trim()) || {};
    const attendance = attendanceByDoc.get(doc) || attendanceByEmployee.get(String(status.employeeId || '').trim()) || {};
    const replacement = replacementByDoc.get(doc) || {};
    rows.push(normalizeRecord({ status, employee, attendance, replacement }));
  });

  if (!rows.length) {
    (registry.employees || []).forEach((employee) => {
      const doc = String(employee.documento || '').trim();
      rows.push(normalizeRecord({
        employee,
        attendance: attendanceByDoc.get(doc) || attendanceByEmployee.get(String(employee.id || '').trim()) || {},
        replacement: replacementByDoc.get(doc) || {}
      }));
    });
  }

  const seenDocs = new Set(rows.map((row) => String(row.documento || '').trim()).filter(Boolean));
  (registry.attendance || []).forEach((attendance) => {
    const doc = String(attendance.documento || '').trim();
    if (doc && seenDocs.has(doc)) return;
    rows.push(normalizeRecord({ attendance, employee: employeesByDoc.get(doc) || {}, replacement: replacementByDoc.get(doc) || {} }));
  });

  return rows.sort((a, b) => {
    const statusRank = { pendiente: 0, novedad: 1, ausente: 2, presente: 3, neutral: 4 };
    const rankDiff = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (rankDiff) return rankDiff;
    return String(a.nombre || '').localeCompare(String(b.nombre || ''));
  });
}

function normalizeRecord({ status = {}, employee = {}, attendance = {}, replacement = {} }) {
  const doc = status.documento || employee.documento || attendance.documento || replacement.documento || null;
  const hasAttendance = Boolean(attendance.id || status.sourceAttendanceId || status.asistio === true);
  const novelty = status.novedadNombre || attendance.novedadNombre || attendance.novedad || replacement.novedadNombre || null;
  const estadoDia = status.estadoDia || null;
  const isAbsent = /ausen|incap|permiso|retiro/i.test(String(estadoDia || novelty || ''));
  const hasNovelty = Boolean(novelty && !hasAttendance) || Boolean(replacement.id);
  let recordStatus = 'pendiente';
  if (hasAttendance) recordStatus = novelty ? 'novedad' : 'presente';
  else if (isAbsent) recordStatus = 'ausente';
  else if (hasNovelty) recordStatus = 'novedad';
  return {
    id: status.id || employee.id || attendance.id || replacement.id || doc || cryptoRandomId(),
    employeeId: status.employeeId || employee.id || attendance.empleadoId || replacement.empleadoId || null,
    documento: doc,
    nombre: status.nombre || employee.nombre || attendance.nombre || replacement.nombre || null,
    telefono: employee.telefono || null,
    sedeCodigo: status.sedeCodigo || employee.sedeCodigo || attendance.sedeCodigo || replacement.sedeCodigo || null,
    sedeNombre: status.sedeNombreSnapshot || employee.sedeNombre || attendance.sedeNombre || replacement.sedeNombre || null,
    zonaCodigo: status.zonaCodigoSnapshot || employee.zonaCodigo || null,
    zonaNombre: status.zonaNombreSnapshot || employee.zonaNombre || null,
    estadoDia,
    novedad: novelty,
    hora: attendance.hora || formatTime(attendance.createdAt) || null,
    reemplazo: replacement.supernumerarioNombre || status.reemplazadoPorNombre || null,
    decisionCobertura: replacement.decision || status.decisionCobertura || null,
    status: recordStatus,
    hasNovelty
  };
}

function filterRows(rows) {
  const term = searchText.trim().toLowerCase();
  return rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (sedeFilter !== 'all' && row.sedeNombre !== sedeFilter) return false;
    if (!term) return true;
    return [row.nombre, row.documento, row.sedeNombre, row.novedad, row.zonaNombre]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });
}

function summarizeRows(rows) {
  return {
    expected: rows.length,
    present: rows.filter((row) => row.status === 'presente' || row.status === 'novedad').length,
    pending: rows.filter((row) => row.status === 'pendiente').length,
    novelties: rows.filter((row) => row.status === 'novedad' || row.status === 'ausente').length
  };
}

function pendingRows(rows) {
  return rows.filter((row) => row.status === 'pendiente');
}

function summaryLabel(summary) {
  if (!supervisorZones().length) return 'No tienes zonas asignadas todavia.';
  if (!summary.expected) return 'No hay registros cargados para esta fecha.';
  if (summary.pending > 0) return `Hay ${summary.pending} personas pendientes por revisar.`;
  return 'El registro diario de tus zonas esta al dia.';
}

function displayName() {
  return currentProfile?.displayName || currentProfile?.email || currentUser?.email || 'Supervisor';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('57')) return digits;
  if (digits.length === 10) return `57${digits}`;
  return digits;
}

function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatTime(value) {
  try {
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

function cryptoRandomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}
