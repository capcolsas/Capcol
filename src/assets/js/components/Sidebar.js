import { el, qs } from '../utils/dom.js';
import { isReviewableShiftStatus } from '../utils/shiftReview.js';
import { navigate } from '../router.js';
import { getState, setState, subscribe } from '../state.js';
import { can, isSuperAdmin, PERMS } from '../permissions.js';
import { contractFilterCode, contractMatches, contractOption, contractRowsForProfile, latestCurrentContractCode, sortContractsLatestFirst } from '../utils/contractScope.js';

const MOBILE_BREAKPOINT = '(max-width: 900px)';
const VALID_THEMES = new Set(['light', 'dark']);
const SETTINGS_ROUTES = new Set([
  '/contracts',
  '/gobierno-dashboard',
  '/permissions',
  '/permissions-audit',
  '/users',
  '/tablets-qr',
  '/lector-qr',
  '/about',
  '/data-treatment'
]);

function updateSidebarState(patch) {
  const current = getState();
  const changes = Object.fromEntries(Object.entries(patch).filter(([key, value]) => current[key] !== value));
  if (Object.keys(changes).length) setState(changes);
}

export const Sidebar = (deps = {}) => {
  const container = el('div', {});

  let contracts = [];
  // app.js renders once with empty dependencies and a restored user, then
  // remounts after the services and session are ready. No request has failed.
  let contractsStatus = 'loading';
  let ignoreLoadErrorFallback = false;
  const { user, userProfile } = getState();
  let cleanupBadges = () => {};
  let renderingContent = false;
  let disposed = false;
  const contentKey = () => JSON.stringify([
    getState().selectedContractCode, getState().sidebarContext, isSettingsMode(), contractsStatus, contracts
  ]);

  applySidebarKind(Boolean(user && userProfile));
  container.replaceChildren(...buildSidebarContent(contracts, deps, contractsStatus));
  let renderedKey = contentKey();
  let renderedContractsKey = JSON.stringify(contracts);
  scheduleLucideIcons();
  bindSidebarBackdrop();
  ensureMobileSidebarState();

  const initialCollapsed = getSidebarCollapsedPref();
  applySidebarCollapsed(initialCollapsed);

  const applyTheme = (t) => document.documentElement.setAttribute('data-theme', VALID_THEMES.has(t) ? t : 'light');
  applyTheme(getState().theme);
  const unsub = subscribe('theme', applyTheme);
  const unPendingBadge = bindPendingNoveltyBadge(container, deps);
  const unFreeSupernumerariosBadge = bindFreeSupernumerariosBadge(container, deps);
  const unShiftReviewBadge = bindShiftReviewBadge(container, deps);
  cleanupBadges = () => {
    unPendingBadge?.();
    unFreeSupernumerariosBadge?.();
    unShiftReviewBadge?.();
  };
  const rerenderContent = () => {
    if (disposed || renderingContent || renderedKey === contentKey()) return;
    renderingContent = true;
    try {
      cleanupBadges?.();
      applySidebarKind(Boolean(getState().user && getState().userProfile));
      const contractsKey = JSON.stringify(contracts);
      const rail = renderedContractsKey === contractsKey ? container.querySelector?.('.sidebar__rail') : null;
      container.replaceChildren(...buildSidebarContent(contracts, deps, contractsStatus, rail));
      renderedContractsKey = contractsKey;
      scheduleLucideIcons();
      applySidebarCollapsed(getSidebarCollapsedPref());
      const unPending = bindPendingNoveltyBadge(container, deps);
      const unFree = bindFreeSupernumerariosBadge(container, deps);
      const unShift = bindShiftReviewBadge(container, deps);
      cleanupBadges = () => {
        unPending?.();
        unFree?.();
        unShift?.();
      };
    } finally {
      renderedKey = contentKey();
      renderingContent = false;
    }
  };
  const unContracts = user && userProfile && typeof deps.streamContracts === 'function'
    ? deps.streamContracts((rows) => {
      // streamTable emits an empty list immediately after LOAD_ERROR.
      if (ignoreLoadErrorFallback) {
        ignoreLoadErrorFallback = false;
        if (!rows?.length) return;
      }
      contracts = rows || [];
      contractsStatus = 'ready';
      rerenderContent();
    }, (_error, status) => {
      if (status !== 'LOAD_ERROR') return;
      ignoreLoadErrorFallback = true;
      // streamTable retries failed requests automatically. Keep the initial
      // loading state, or the last successful catalog, while it reconnects.
      if (contractsStatus !== 'ready') contractsStatus = 'loading';
      rerenderContent();
    })
    : (() => {});
  const unSelectedContract = user && userProfile
    ? subscribe('selectedContractCode', () => {
      if (renderingContent) return;
      rerenderContent();
    })
    : (() => {});
  const unSidebarContext = user && userProfile
    ? subscribe('sidebarContext', () => {
      if (renderingContent) return;
      rerenderContent();
    })
    : (() => {});
  const syncActiveRoute = () => {
    rerenderContent();
    const route = getCurrentRoute();
    container.querySelectorAll('.sidebar__nav-link,.sidebar__section-link').forEach(node => {
      const target = node.dataset.route || (node.getAttribute('href') || '').replace(/^#/, '');
      const active = target === route;
      node.classList.toggle('is-active', active);
      if (active) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    });
  };
  window.addEventListener('hashchange', syncActiveRoute);
  container._cleanup = () => {
    disposed = true;
    window.removeEventListener('hashchange', syncActiveRoute);
    unsub?.();
    cleanupBadges?.();
    unContracts?.();
    unSelectedContract?.();
    unSidebarContext?.();
  };

  return container;
};

function buildSidebarContent(contracts = [], deps = {}, contractsStatus = 'ready', existingRail = null) {
  const { user, userProfile } = getState();
  if (!user || !userProfile) return [
    el('nav', { className: 'sidebar__rail', 'aria-label': 'Rocky' }, [
      rockyRailButton(() => navigate('/login'), false)
    ])
  ];
  const scopedContracts = contractRowsForProfile(contracts, userProfile);
  return [buildDoubleSidebarShell(scopedContracts, deps, contractsStatus, existingRail)];
}

function buildDoubleSidebarShell(contracts = [], deps = {}, contractsStatus = 'ready', existingRail = null) {
  const rows = sortContractsLatestFirst(contracts).filter(contract => String(contract.codigo || '').trim());
  const selected = ensureSelectedProjectContract(rows);
  const selectedContract = rows.find((contract) => String(contract.codigo || '').trim() === selected) || rows[0] || null;
  const settingsActive = isSettingsMode();
  const panelChildren = settingsActive
    ? buildSettingsPanel()
    : contractsStatus !== 'ready' || !selectedContract
      ? buildContractPlaceholder(contractsStatus, rows.length > 0)
      : buildProjectPanel(selectedContract, selected);
  const rail = existingRail || buildProjectRail(rows, selected, settingsActive, deps);
  rail.querySelectorAll('[data-contract-code],[data-rail-settings]').forEach(button => {
    const active = button.hasAttribute('data-rail-settings') ? settingsActive : !settingsActive && button.dataset.contractCode === selected;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-expanded', String(active && !getSidebarCollapsedPref()));
  });
  return el('div', { className: 'sidebar__shell' }, [
    rail,
    el('div', { className: 'sidebar__panel', id: 'sidebar-context-panel' }, [buildCompanyBrand(), ...panelChildren])
  ]);
}

function ensureSelectedProjectContract(contracts = []) {
  const rows = sortContractsLatestFirst(contracts);
  const defaultCode = latestCurrentContractCode(rows);
  const current = contractFilterCode();
  const codes = new Set(rows.map((contract) => String(contract.codigo || '').trim()).filter(Boolean));
  const selected = codes.has(current) ? current : defaultCode;
  if (selected && current !== selected) setState({ selectedContractCode: selected });
  return selected;
}

function buildProjectRail(contracts = [], selectedCode = '', settingsActive = false, deps = {}) {
  const contractButtons = contracts.map((contract) => contractRailButton(contract, selectedCode, deps));
  const settingsRoute = firstAvailableSettingsRoute();
  const settingsBtn = railButton({
    icon: 'settings',
    fallback: 'CFG',
    title: 'Configuracion global',
    active: settingsActive,
    controlsPanel: true,
    onClick: () => {
      if (toggleCurrentSidebarPanel(isSettingsMode())) return;
      updateSidebarState({ sidebarContext: 'settings' });
      navigate(settingsRoute);
    }
  });
  const logoutBtn = railButton({
    icon: 'log-out',
    fallback: 'SAL',
    title: 'Cerrar sesion',
    className: 'sidebar__rail-btn--user',
    onClick: async () => {
      await deps.logout?.();
      navigate('/login');
      closeMobileSidebar();
    }
  });
  settingsBtn.dataset.railSettings = 'true';

  return el('nav', { className: 'sidebar__rail', 'aria-label': 'Contextos de trabajo' }, [
    rockyRailButton(() => {
        if (toggleCurrentSidebarPanel(!isSettingsMode())) return;
        updateSidebarState({ sidebarContext: 'contract' });
        if (contractFilterCode()) navigate(firstAvailableProjectRoute());
    }),
    el('div', { className: 'sidebar__rail-contracts' }, contractButtons),
    el('div', { className: 'sidebar__rail-bottom' }, [
      settingsBtn,
      logoutBtn
    ])
  ]);
}

function rockyRailButton(onClick, controlsPanel = true) {
  const button = railButton({ title: 'Rocky', className: 'sidebar__rail-logo', controlsPanel, onClick });
  const logo = el('img', { className: 'sidebar__rocky-logo', src: 'src/assets/img/rocky-logo.png', alt: '', 'aria-hidden': 'true' });
  logo.addEventListener('error', () => button.replaceChildren('R'), { once: true });
  button.replaceChildren(logo);
  return button;
}

function contractRailButton(contract = {}, selectedCode = '', deps = {}) {
  const code = String(contract.codigo || '').trim();
  const button = railButton({
    fallback: contractInitials(contract),
    title: contractProjectTitle(contract),
    active: Boolean(code && code === selectedCode && !isSettingsMode()),
    controlsPanel: true,
    onClick: () => {
      if (toggleCurrentSidebarPanel(code === contractFilterCode() && !isSettingsMode())) return;
      if (code) updateSidebarState({ selectedContractCode: code, sidebarContext: 'contract' });
      navigate(firstAvailableProjectRoute());
    }
  });
  button.dataset.contractCode = code;
  if (contract.referenceImagePath && typeof deps.getContractReferenceImageUrl === 'function') {
    deps.getContractReferenceImageUrl(contract.referenceImagePath).then(url => {
      if (!url) return;
      const img = el('img', { className: 'sidebar__contract-image', src: url, alt: '', 'aria-hidden': 'true' });
      img.addEventListener('load', () => button.replaceChildren(img), { once: true });
      // Keep the initials if signing or loading the image fails.
    }).catch(() => {});
  }
  return button;
}

function railButton({ icon = '', fallback = '', title = '', active = false, className = '', label = '', controlsPanel = false, onClick = null } = {}) {
  const btn = el('button', {
    className: `sidebar__rail-btn${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`,
    type: 'button',
    title,
    'aria-controls': controlsPanel ? 'sidebar-context-panel' : undefined,
    'aria-expanded': controlsPanel ? String((active || (className === 'sidebar__rail-logo' && !isSettingsMode())) && !getSidebarCollapsedPref()) : undefined,
    'aria-label': title || fallback || label || 'Accion'
  }, [
    label ? el('span', { className: 'sidebar__rail-avatar' }, [label])
      : icon ? lucideIcon(icon, fallback, 'sidebar__rail-icon')
        : el('span', { className: 'sidebar__rail-icon', 'aria-hidden': 'true' }, [fallback])
  ]);
  btn.addEventListener('click', () => onClick?.());
  return btn;
}

function buildProjectPanel(contract = null, selectedCode = '') {
  const code = String(selectedCode || contract?.codigo || '').trim();
  if (!contract || !code) return buildContractPlaceholder('ready', false);
  const links = buildContractProjectLinks(code);
  const title = el('strong', { className: 'sidebar__project-title' }, [contract.nombre || code]);
  let heading = title;
  if (can(PERMS.VIEW_CONTRACTS)) {
    heading = el('a', {
      className: 'sidebar__project-title-link',
      href: '#/contract-details',
      title: 'Ver datos del contrato'
    }, [title]);
    heading.addEventListener('click', (event) => {
      event.preventDefault();
      updateSidebarState({ selectedContractCode: code, sidebarContext: 'contract' });
      navigate('/contract-details');
      closeMobileSidebar();
    });
  }
  return [
    el('div', { className: 'sidebar__project-head sidebar__project-head--contract' }, [
      heading
    ]),
    ...(Array.isArray(links) ? links : [])
  ];
}

function buildContractPlaceholder(status, hasContracts) {
  const loading = status === 'loading';
  const failed = status === 'error';
  const title = loading ? 'Cargando contratos…'
    : failed ? 'Contratos no disponibles temporalmente'
      : hasContracts ? 'Selecciona un contrato' : 'Sin contratos disponibles';
  const message = loading ? 'Estamos preparando la información de tus contratos.'
    : failed ? 'Actualiza la página para volver a consultar tus contratos.'
      : hasContracts ? 'No hay un contrato seleccionado.' : 'No tienes contratos disponibles para trabajar.';
  const content = [el('div', { className: 'sidebar__project-head sidebar__contract-state', role: 'status', 'aria-live': 'polite' }, [
    el('span', { className: 'sidebar__project-kicker' }, ['Contratos']),
    el('strong', { className: 'sidebar__project-title' }, [title]),
    el('span', { className: 'sidebar__project-meta' }, [message])
  ])];
  if (!loading && can(PERMS.VIEW_CONTRACTS)) {
    content.push(navLink('Gestionar contratos', '/contracts', { sidebarContext: 'settings' }));
  }
  return content;
}

function buildCompanyBrand() {
  const logo = el('img', { className: 'sidebar__company-logo', src: 'src/assets/img/tercero.png', alt: 'Capcol S.A.S.' });
  const name = el('span', { className: 'sidebar__company-copy' }, [
    el('span', { className: 'sidebar__company-name' }, ['CAPCOL S.A.S.']),
    el('span', { className: 'sidebar__company-nit' }, ['NIT 900.939.656-7'])
  ]);
  const link = el('a', { className: 'sidebar__company-brand', href: '#/', title: 'Rocky Soluciones de Capcol S.A.S.', 'aria-label': 'Ir al resumen' }, [logo, name]);
  logo.addEventListener('error', () => logo.remove(), { once: true });
  return link;
}

function buildSettingsPanel() {
  return [
    el('div', { className: 'sidebar__project-head sidebar__project-head--settings' }, [
      el('strong', { className: 'sidebar__project-title' }, ['Configuracion'])
    ]),
    ...buildSettingsSections()
  ];
}

function buildSettingsSections() {
  const sections = [];
  const options = { sidebarContext: 'settings' };
  const govLinks = [];
  if (isSuperAdmin() || can(PERMS.VIEW_PERMISSIONS)) govLinks.push(navLink('Centro de Permisos', '/permissions', options));
  if (isSuperAdmin() || can(PERMS.VIEW_AUDIT)) govLinks.push(navLink('Auditoria', '/permissions-audit', options));
  if (can(PERMS.VIEW_USERS)) govLinks.push(navLink('Usuarios', '/users', options));
  if (govLinks.length) sections.push(section('Gobierno', govLinks, 'settings_gobierno', '/gobierno-dashboard', { icon: 'shield-check', fallback: 'GO', sidebarContext: 'settings' }));

  const companyLinks = [];
  if (can(PERMS.VIEW_CONTRACTS)) companyLinks.push(navLink('Contratos', '/contracts', options));
  if (can(PERMS.VIEW_QR_DEVICES)) companyLinks.push(navLink('Tablets QR', '/tablets-qr', options));
  if (can(PERMS.VIEW_QR_SCANNER)) companyLinks.push(navLink('Lector QR', '/lector-qr', options));
  if (companyLinks.length) sections.push(section('Empresa', companyLinks, 'settings_empresa', '/contracts', { icon: 'building-2', fallback: 'EM', sidebarContext: 'settings' }));

  return sections;
}

function buildStandardSections({ includeConsolidatedReports = true, linkOptions = {} } = {}) {
  const sections = [];
  const govLinks = [];
  if (isSuperAdmin() || can(PERMS.VIEW_PERMISSIONS)) govLinks.push(navLink('Centro de Permisos', '/permissions', linkOptions));
  if (isSuperAdmin() || can(PERMS.VIEW_AUDIT)) govLinks.push(navLink('Auditoria', '/permissions-audit', linkOptions));
  if (can(PERMS.VIEW_USERS)) govLinks.push(navLink('Usuarios', '/users', linkOptions));
  if (govLinks.length) sections.push(section('Gobierno', govLinks, 'gobierno', '/gobierno-dashboard'));

  const adminLinks = [];
  if (can(PERMS.VIEW_CONTRACTS)) adminLinks.push(navLink('Contratos', '/contracts', linkOptions));
  if (can(PERMS.VIEW_ZONES)) adminLinks.push(navLink('Zonas', '/zones', linkOptions));
  if (can(PERMS.VIEW_DEPENDENCIES)) adminLinks.push(navLink('Dependencias', '/dependencies', linkOptions));
  if (can(PERMS.VIEW_QR_SCANNER)) adminLinks.push(navLink('Lector QR', '/lector-qr', linkOptions));
  if (can(PERMS.VIEW_QR_DEVICES)) adminLinks.push(navLink('Tablets QR', '/tablets-qr', linkOptions));
  if (can(PERMS.VIEW_CARGOS)) adminLinks.push(navLink('Cargos', '/cargos', linkOptions));
  if (can(PERMS.VIEW_NOVEDADES)) adminLinks.push(navLink('Novedades', '/novedades', linkOptions));
  if (adminLinks.length) sections.push(subSection('Administracion', adminLinks, 'administracion'));

  const sedeLinks = [];
  if (can(PERMS.VIEW_SEDES)) sedeLinks.push(navLink('Sedes', '/sedes', linkOptions));
  if (can(PERMS.VIEW_SEDES)) sedeLinks.push(navLink('Ubicacion sedes', '/sedes-ubicacion', linkOptions));
  if (sedeLinks.length) sections.push(section('Sedes', sedeLinks, 'sedes', '/sedes'));

  const shiftLinks = [];
  if (can(PERMS.VIEW_GENERATED_SHIFTS)) shiftLinks.push(navLink('Calendario', '/turnos-calendario', linkOptions));
  if (can(PERMS.VIEW_SHIFT_PLANS)) shiftLinks.push(navLink('Planes de turnos', '/turnos-planes', linkOptions));
  if (can(PERMS.VIEW_GENERATED_SHIFTS)) shiftLinks.push(navLink('Turnos generados', '/turnos-generados', linkOptions));
  if (can(PERMS.VIEW_SHIFT_REVIEW)) shiftLinks.push(navLink('Revision de turnos', '/turnos-revision', { badgeId: 'sidebarShiftReviewBadge', ...linkOptions }));
  if (can(PERMS.EDIT_CONTRACTS)) shiftLinks.push(navLink('Visitas', '/turnos-visitas', linkOptions));
  if (shiftLinks.length) sections.push(section('Turnos', shiftLinks, 'turnos', '/turnos-revision'));

  const employeeLinks = [];
  if (can(PERMS.VIEW_EMPLOYEES)) employeeLinks.push(navLink('Empleados', '/employees', linkOptions));
  if (can(PERMS.VIEW_EMPLOYEE_NOVELTIES)) employeeLinks.push(navLink('Novedades empleados', '/employee-novelties', linkOptions));
  if (can(PERMS.VIEW_SUPERVISORS)) employeeLinks.push(navLink('Supervisores', '/supervisors', linkOptions));
  if (can(PERMS.VIEW_INCAPACITIES)) employeeLinks.push(navLink('Incapacidades', '/upload', linkOptions));
  if (employeeLinks.length) sections.push(section('Empleados', employeeLinks, 'empleados', '/empleados-dashboard'));

  const opLinks = [];
  if (can(PERMS.VIEW_OPERATION_REGISTRY) || can(PERMS.VIEW_QR_DAILY_REGISTRY)) opLinks.push(navLink('Registro Diario', '/registros-vivo', { badgeId: 'sidebarRegistroDiarioBadge', ...linkOptions }));
  if (can(PERMS.VIEW_SUPERNUMERARIOS)) opLinks.push(navLink('Supernumerarios', '/supernumerarios', { badgeId: 'sidebarSupernumerariosFreeBadge', badgeAlwaysVisible: true, badgeAriaLabel: '0 supernumerarios libres hoy', ...linkOptions }));
  if (can(PERMS.VIEW_OPERATION_REGISTRY)) opLinks.push(navLink('Registro Sede', '/registro-sede', linkOptions));
  if (can(PERMS.VIEW_IMPORT_HISTORY)) opLinks.push(navLink('Historial', '/import-history', linkOptions));
  if (opLinks.length) sections.push(section('Operacion', opLinks, 'operacion', '/operacion-dashboard'));

  const reportLinks = [];
  const dailyReportLinks = [];
  if (can(PERMS.VIEW_REPORTS_EMPLOYEES)) reportLinks.push(navLink('Empleados', '/reports-employees', linkOptions));
  if (can(PERMS.VIEW_REPORTS_HIRING)) reportLinks.push(navLink('Contratacion por Sedes', '/reports-hiring', linkOptions));
  if (can(PERMS.VIEW_REPORTS_CLIENT)) dailyReportLinks.push(navLink('Historico Registro Diario', '/reports-daily-history', linkOptions));
  if (can(PERMS.VIEW_REPORTS_QR_HISTORY)) dailyReportLinks.push(navLink('Historico de asistencia', '/reports-qr-history', linkOptions));
  if (can(PERMS.VIEW_REPORTS_ABSENTEEISM)) dailyReportLinks.push(navLink('Ausentismo', '/absenteeism', linkOptions));
  if (dailyReportLinks.length) reportLinks.push(subSection('Reportes diarios', dailyReportLinks, 'reportes_diarios'));
  if (includeConsolidatedReports) {
    const consolidatedReportLinks = [];
    if (can(PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED)) consolidatedReportLinks.push(navLink('Consolidado Novedades', '/reports-novelties-consolidated', linkOptions));
    if (can(PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED)) consolidatedReportLinks.push(navLink('Consolidado Servicios', '/reports-services-consolidated', linkOptions));
    if (consolidatedReportLinks.length) reportLinks.push(subSection('Reportes consolidados', consolidatedReportLinks, 'reportes_consolidados'));
  }
  if (reportLinks.length) sections.push(section('Reportes', reportLinks, 'reportes', '/reportes-dashboard'));

  const bulkLinks = [];
  if (can(PERMS.VIEW_BULK_UPLOAD_SEDES)) bulkLinks.push(navLink('Cargue sedes', '/bulk-upload-sedes', linkOptions));
  if (can(PERMS.VIEW_BULK_UPLOAD_EMPLOYEES)) bulkLinks.push(navLink('Cargue empleados', '/bulk-upload', linkOptions));
  if (can(PERMS.VIEW_BULK_UPLOAD_EMPLOYEES)) bulkLinks.push(navLink('Actualizar empleados', '/bulk-update-employees', linkOptions));
  if (bulkLinks.length) sections.push(section('Cargue masivo', bulkLinks, 'cargue_masivo', '/cargue-masivo-dashboard'));
  return sections;
}

function buildContractProjectSections(contracts = []) {
  const rows = sortContractsLatestFirst(contracts);
  const defaultCode = latestCurrentContractCode(rows);
  const current = contractFilterCode();
  const codes = new Set(rows.map((contract) => String(contract.codigo || '').trim()).filter(Boolean));
  const selected = codes.has(current) ? current : defaultCode;
  if (selected && current !== selected) setState({ selectedContractCode: selected });
  return rows.map((contract) => contractProjectSection(contract, String(contract.codigo || '').trim() === selected));
}

function contractProjectSection(contract = {}, expanded = false) {
  const code = String(contract.codigo || '').trim();
  const title = contractProjectTitle(contract);
  const links = buildContractProjectLinks(code);
  return section(title, links, `contract_${code}`, firstAvailableProjectRoute(), {
    forceCollapsed: !expanded,
    contractCode: code,
    icon: 'briefcase-business',
    fallback: code.slice(0, 2).toUpperCase() || 'CT',
    collapseSiblings: true
  });
}

function buildContractProjectLinks(contractCode) {
  const options = { contractCode, sidebarContext: 'contract' };
  const groups = [];
  const summaryLinks = [];
  if (can(PERMS.VIEW_REPORTS_CLIENT)) summaryLinks.push(navLink('Resumen', '/contract-dashboard', options));
  if (summaryLinks.length) groups.push(...summaryLinks);
  const adminLinks = [];
  if (can(PERMS.VIEW_ZONES)) adminLinks.push(navLink('Zonas', '/zones', options));
  if (can(PERMS.VIEW_DEPENDENCIES)) adminLinks.push(navLink('Dependencias', '/dependencies', options));
  if (can(PERMS.VIEW_CARGOS)) adminLinks.push(navLink('Cargos y salarios', '/cargos', options));
  if (can(PERMS.VIEW_NOVEDADES)) adminLinks.push(navLink('Novedades', '/novedades', options));
  if (adminLinks.length) groups.push(subSection('Administracion', adminLinks, `contract_admin_${contractCode}`));

  const sedeLinks = [];
  if (can(PERMS.VIEW_SEDES)) sedeLinks.push(navLink('Sedes', '/sedes', options));
  if (can(PERMS.VIEW_SEDES)) sedeLinks.push(navLink('Ubicacion sedes', '/sedes-ubicacion', options));
  if (sedeLinks.length) groups.push(subSection('Sedes', sedeLinks, `contract_sedes_${contractCode}`));

  const shiftLinks = [];
  if (can(PERMS.VIEW_GENERATED_SHIFTS)) shiftLinks.push(navLink('Calendario', '/turnos-calendario', options));
  if (can(PERMS.VIEW_SHIFT_PLANS)) shiftLinks.push(navLink('Planes de turnos', '/turnos-planes', options));
  if (can(PERMS.VIEW_GENERATED_SHIFTS)) shiftLinks.push(navLink('Turnos generados', '/turnos-generados', options));
  if (can(PERMS.MANAGE_GENERATED_SHIFTS)) shiftLinks.push(navLink('Rotaciones', '/turnos-rotaciones', options));
  if (can(PERMS.VIEW_SHIFT_REVIEW)) shiftLinks.push(navLink('Revision de turnos', '/turnos-revision', options));
  if (can(PERMS.EDIT_CONTRACTS)) shiftLinks.push(navLink('Visitas', '/turnos-visitas', options));
  if (shiftLinks.length) groups.push(subSection('Turnos', shiftLinks, `contract_turnos_${contractCode}`));

  const employeeLinks = [];
  if (can(PERMS.VIEW_EMPLOYEES)) employeeLinks.push(navLink('Empleados', '/employees', options));
  if (can(PERMS.VIEW_EMPLOYEE_NOVELTIES)) employeeLinks.push(navLink('Novedades empleados', '/employee-novelties', options));
  if (can(PERMS.VIEW_SUPERVISORS)) employeeLinks.push(navLink('Supervisores', '/supervisors', options));
  if (can(PERMS.VIEW_INCAPACITIES)) employeeLinks.push(navLink('Incapacidades', '/upload', options));
  if (can(PERMS.VIEW_SUPERNUMERARIOS)) employeeLinks.push(navLink('Supernumerarios', '/supernumerarios', options));
  const employeeDashboard = [PERMS.VIEW_EMPLOYEES, PERMS.VIEW_EMPLOYEE_NOVELTIES, PERMS.VIEW_SUPERVISORS, PERMS.VIEW_INCAPACITIES].some(can);
  if (employeeLinks.length || employeeDashboard) groups.push(subSection('Personal', employeeLinks, `contract_personal_${contractCode}`, employeeDashboard ? '/empleados-dashboard' : '', options));

  const opLinks = [];
  if (can(PERMS.VIEW_OPERATION_REGISTRY) || can(PERMS.VIEW_QR_DAILY_REGISTRY)) opLinks.push(navLink('Registro Diario', '/registros-vivo', options));
  if (can(PERMS.VIEW_OPERATION_REGISTRY)) opLinks.push(navLink('Registro Sede', '/registro-sede', options));
  if (can(PERMS.VIEW_IMPORT_HISTORY)) opLinks.push(navLink('Historial', '/import-history', options));
  const operationDashboard = [PERMS.VIEW_OPERATION_REGISTRY, PERMS.VIEW_QR_DAILY_REGISTRY, PERMS.VIEW_SUPERNUMERARIOS, PERMS.VIEW_IMPORT_HISTORY].some(can);
  if (opLinks.length || operationDashboard) groups.push(subSection('Operacion', opLinks, `contract_operacion_${contractCode}`, operationDashboard ? '/operacion-dashboard' : '', options));

  const reportLinks = [];
  if (can(PERMS.VIEW_REPORTS_EMPLOYEES)) reportLinks.push(navLink('Empleados', '/reports-employees', options));
  if (can(PERMS.VIEW_REPORTS_HIRING)) reportLinks.push(navLink('Contratacion por Sedes', '/reports-hiring', options));
  if (can(PERMS.VIEW_REPORTS_CLIENT)) reportLinks.push(navLink('Historico Registro Diario', '/reports-daily-history', options));
  if (can(PERMS.VIEW_REPORTS_QR_HISTORY)) reportLinks.push(navLink('Historico de asistencia', '/reports-qr-history', options));
  if (can(PERMS.VIEW_REPORTS_ABSENTEEISM)) reportLinks.push(navLink('Ausentismo', '/absenteeism', options));
  const reportDashboard = [PERMS.VIEW_REPORTS_CLIENT, PERMS.VIEW_REPORTS_QR_HISTORY, PERMS.VIEW_REPORTS_ABSENTEEISM, PERMS.VIEW_REPORTS_EMPLOYEES, PERMS.VIEW_REPORTS_HIRING, PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED, PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED].some(can);
  if (reportLinks.length || reportDashboard) groups.push(subSection('Reportes', reportLinks, `contract_reportes_${contractCode}`, reportDashboard ? '/reportes-dashboard' : '', options));

  if (can(PERMS.VIEW_INVENTORY)) groups.push(subSection('Inventarios', [
    navLink('Bienes y productos', '/inventory/products', options),
    navLink('Entregas', '/inventory/deliveries', options)
  ], `contract_inventory_${contractCode}`, '/inventory', options));

  const bulkLinks = [];
  if (can(PERMS.VIEW_BULK_UPLOAD_SEDES)) bulkLinks.push(navLink('Cargue sedes', '/bulk-upload-sedes', options));
  if (can(PERMS.VIEW_BULK_UPLOAD_EMPLOYEES)) bulkLinks.push(navLink('Cargue empleados', '/bulk-upload', options));
  if (can(PERMS.VIEW_BULK_UPLOAD_EMPLOYEES)) bulkLinks.push(navLink('Actualizar empleados', '/bulk-update-employees', options));
  const bulkDashboard = [PERMS.VIEW_BULK_UPLOAD_SEDES, PERMS.VIEW_BULK_UPLOAD_EMPLOYEES].some(can);
  if (bulkLinks.length || bulkDashboard) groups.push(subSection('Cargue masivo', bulkLinks, `contract_cargue_${contractCode}`, bulkDashboard ? '/cargue-masivo-dashboard' : '', options));

  return groups;
}

function contractProjectTitle(contract = {}) {
  const option = contractOption(contract);
  return option.label || String(contract.codigo || contract.nombre || 'Contrato').trim() || 'Contrato';
}

export function firstAvailableProjectRoute() {
  if (can(PERMS.VIEW_INVENTORY) && !can(PERMS.VIEW_CONTRACTS) && !can(PERMS.VIEW_REPORTS_CLIENT)) return '/inventory';
  if (can(PERMS.VIEW_REPORTS_CLIENT)) return '/contract-dashboard';
  if (can(PERMS.VIEW_CONTRACTS)) return '/contract-details';
  if (can(PERMS.VIEW_SEDES)) return '/sedes';
  if (can(PERMS.VIEW_EMPLOYEES)) return '/employees';
  if (can(PERMS.VIEW_OPERATION_REGISTRY)) return '/registros-vivo';
  if (can(PERMS.VIEW_SHIFT_PLANS)) return '/turnos-planes';
  if (can(PERMS.EDIT_CONTRACTS)) return '/turnos-visitas';
  return '/about';
}

function firstAvailableSettingsRoute() {
  if (isSuperAdmin() || can(PERMS.VIEW_PERMISSIONS)) return '/permissions';
  if (isSuperAdmin() || can(PERMS.VIEW_AUDIT)) return '/permissions-audit';
  if (can(PERMS.VIEW_USERS)) return '/users';
  if (can(PERMS.VIEW_CONTRACTS)) return '/contracts';
  if (can(PERMS.VIEW_QR_DEVICES)) return '/tablets-qr';
  return '/about';
}

function isSettingsMode() {
  const context = String(getState().sidebarContext || '').trim();
  const route = getCurrentRoute();
  if (route === '/contracts') return true;
  if (route === '/contract-details') return false;
  if (context === 'settings') return true;
  if (context === 'contract') return false;
  return SETTINGS_ROUTES.has(route);
}

function contractInitials(contract = {}) {
  const code = String(contract.codigo || '').trim();
  const name = String(contract.nombre || '').trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  const source = name || code || 'CT';
  const codeMatch = source.match(/[A-Za-z]{2,}|\d{2,}/);
  if (codeMatch) return codeMatch[0].slice(0, 2).toUpperCase();
  return source.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'CT';
}

function contractClientLabel(contract = null) {
  if (!contract) return 'Selecciona un contrato para trabajar';
  const client = String(contract.clienteNombre || contract.cliente_nombre || '').trim();
  const code = String(contract.codigo || '').trim();
  if (client && code) return `${client} · ${code}`;
  return client || code || 'Contrato operativo';
}

function userInitials(user = {}) {
  const source = String(user.nombre || user.name || user.email || user.correo || 'Usuario').trim();
  const parts = source.includes('@') ? [source[0], source.split('@')[0]?.[1]] : source.split(/\s+/).map((part) => part[0]);
  return parts.filter(Boolean).join('').slice(0, 2).toUpperCase() || 'US';
}

function section(title, links, key, dashboardRoute = '', options = {}) {
  const pref = options.forceCollapsed !== undefined ? options.forceCollapsed : getSectionPref(key);
  const meta = options.icon ? { icon: options.icon, fallback: options.fallback || '' } : getSectionIconMeta(key);
  const currentRoute = getCurrentRoute();
  const contractActive = !options.contractCode || contractFilterCode() === String(options.contractCode || '').trim();
  const sec = el('div', { className: `sidebar__section${pref ? ' is-collapsed' : ''}`, dataset: { sectionKey: key } }, []);
  const titleLink = el('button', {
    className: `sidebar__section-link${dashboardRoute && currentRoute === dashboardRoute && contractActive ? ' is-active' : ''}`,
    dataset: { route: dashboardRoute },
    type: 'button',
    title: `Abrir dashboard de ${title}`,
    'aria-label': `Abrir dashboard de ${title}`
  }, [
    el('span', { className: 'sidebar__section-title-content' }, [
      lucideIcon(meta.icon, meta.fallback, 'sidebar__section-icon'),
      el('span', {}, [title])
    ])
  ]);
  const toggleBtn = el('button', {
    className: 'sidebar__section-toggle',
    type: 'button',
    title: pref ? `Expandir ${title}` : `Contraer ${title}`,
    'aria-label': pref ? `Expandir ${title}` : `Contraer ${title}`,
    'aria-expanded': pref ? 'false' : 'true',
    dataset: { sectionTitle: title }
  }, [
    el('span', { className: 'sidebar__section-toggle-glyph', 'aria-hidden': 'true' }, ['▾'])
  ]);
  const header = el('div', { className: 'sidebar__section-title sidebar__section-heading' }, [titleLink, toggleBtn]);
  const nav = el('nav', { className: 'sidebar__nav' }, links);
  const setCollapsed = (collapsed) => {
    sec.classList.toggle('is-collapsed', collapsed);
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggleBtn.title = collapsed ? `Expandir ${title}` : `Contraer ${title}`;
    toggleBtn.setAttribute('aria-label', toggleBtn.title);
    setSectionPref(key, collapsed);
  };
  titleLink.addEventListener('click', () => {
    if (!dashboardRoute) return;
    const statePatch = {};
    if (options.contractCode) statePatch.selectedContractCode = String(options.contractCode || '').trim();
    if (options.sidebarContext) statePatch.sidebarContext = options.sidebarContext;
    updateSidebarState(statePatch);
    const wasCollapsed = sec.classList.contains('is-collapsed');
    collapseSiblingSections(sec);
    setCollapsed(!wasCollapsed);
    navigate(dashboardRoute);
    document.querySelectorAll('.sidebar__nav-link,.sidebar__section-link').forEach((n) => n.classList.remove('is-active'));
    titleLink.classList.add('is-active');
    closeMobileSidebar();
  });
  toggleBtn.addEventListener('click', () => {
    const statePatch = {};
    if (options.contractCode) statePatch.selectedContractCode = String(options.contractCode || '').trim();
    if (options.sidebarContext) statePatch.sidebarContext = options.sidebarContext;
    updateSidebarState(statePatch);
    if (options.collapseSiblings) collapseSiblingSections(sec);
    const collapsed = sec.classList.toggle('is-collapsed');
    setCollapsed(collapsed);
  });
  sec.append(header, nav);
  return sec;
}

function collapseSiblingSections(currentSection) {
  const parent = currentSection?.parentElement;
  if (!parent) return;
  Array.from(parent.querySelectorAll(':scope > .sidebar__section')).forEach((sectionNode) => {
    if (sectionNode === currentSection) return;
    const toggle = sectionNode.querySelector(':scope > .sidebar__section-heading .sidebar__section-toggle');
    const key = sectionNode.getAttribute('data-section-key') || '';
    sectionNode.classList.add('is-collapsed');
    toggle?.setAttribute('aria-expanded', 'false');
    if (toggle) {
      const label = toggle.getAttribute('data-section-title') || 'seccion';
      toggle.title = `Expandir ${label}`;
      toggle.setAttribute('aria-label', toggle.title);
    }
    if (key) setSectionPref(key, true);
  });
}

function subSection(title, links, key, dashboardRoute = '', options = {}) {
  const pref = getSectionPref(`sub_${key}`) && !links.some(link => link.classList.contains('is-active'));
  const meta = getSubsectionIconMeta(key);
  const currentRoute = getCurrentRoute();
  const contractActive = !options.contractCode || contractFilterCode() === String(options.contractCode || '').trim();
  const sec = el('div', { className: `sidebar__subsection${pref ? ' is-collapsed' : ''}` }, []);
  const titleBtn = el('button', {
    className: `sidebar__subsection-title sidebar__subsection-toggle${dashboardRoute && currentRoute === dashboardRoute && contractActive ? ' is-active' : ''}`,
    type: 'button',
    title: dashboardRoute ? `Abrir dashboard de ${title}` : title,
    'aria-label': dashboardRoute ? `Abrir dashboard de ${title}` : title,
    'aria-expanded': pref ? 'false' : 'true'
  }, [
    el('span', { className: 'sidebar__subsection-title-content' }, [
      lucideIcon(meta.icon, meta.fallback, 'sidebar__subsection-icon'),
      el('span', {}, [title])
    ])
  ]);
  const nav = el('nav', { className: 'sidebar__subnav' }, links);
  titleBtn.addEventListener('click', () => {
    if (dashboardRoute) {
      const statePatch = {};
      if (options.contractCode) statePatch.selectedContractCode = String(options.contractCode || '').trim();
      if (options.sidebarContext) statePatch.sidebarContext = options.sidebarContext;
      updateSidebarState(statePatch);
      navigate(dashboardRoute);
      document.querySelectorAll('.sidebar__nav-link,.sidebar__section-link,.sidebar__subsection-title').forEach((n) => n.classList.remove('is-active'));
      titleBtn.classList.add('is-active');
      closeMobileSidebar();
    }
    const collapsed = sec.classList.toggle('is-collapsed');
    titleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    setSectionPref(`sub_${key}`, collapsed);
  });
  sec.append(titleBtn, nav);
  return sec;
}

function navLink(text, to, options = {}) {
  const iconMeta = getNavIconMeta(to);
  const textNode = el('span', { className: 'sidebar__item-text' }, [text]);
  const badgeId = options.disableBadges ? '' : options.badgeId;
  const content = badgeId
    ? el('span', { className: 'sidebar__item-content' }, [
      textNode,
      el('span', {
        id: badgeId,
        className: `sidebar__nav-badge${options.badgeClassName ? ` ${options.badgeClassName}` : ''}`,
        hidden: options.badgeAlwaysVisible ? false : true,
        'aria-label': options.badgeAriaLabel || '0 novedades pendientes'
      }, ['0'])
    ])
    : textNode;
  const contractActive = !options.contractCode || contractFilterCode() === String(options.contractCode || '').trim();
  const active = getCurrentRoute() === to && contractActive;
  const a = el('a', { href: `#${to}`, className: `sidebar__nav-link${active ? ' is-active' : ''}` }, [
    lucideIcon(iconMeta.icon, iconMeta.fallback, 'sidebar__item-icon'),
    content
  ]);
  a.title = text;
  a.setAttribute('aria-label', text);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const statePatch = {};
    if (options.contractCode) statePatch.selectedContractCode = String(options.contractCode || '').trim();
    if (options.sidebarContext) statePatch.sidebarContext = options.sidebarContext;
    updateSidebarState(statePatch);
    navigate(to);
    document.querySelectorAll('.sidebar__nav-link,.sidebar__section-link').forEach((n) => n.classList.remove('is-active'));
    a.classList.add('is-active');
    closeMobileSidebar();
  });
  return a;
}

function lucideIcon(iconName, fallback, className) {
  return el('span', { className, 'aria-hidden': 'true' }, [
    el('span', { className: 'sidebar__icon-fallback' }, [fallback || '']),
    el('i', { className: 'sidebar__icon-svg', 'data-lucide': iconName || 'circle' }, [])
  ]);
}

function scheduleLucideIcons(attempt = 0) {
  requestAnimationFrame(() => {
    if (globalThis.lucide?.createIcons) {
      globalThis.lucide.createIcons({
        attrs: {
          'stroke-width': 2,
          width: 18,
          height: 18
        }
      });
      document.querySelectorAll('.sidebar__item-icon,.sidebar__section-icon,.sidebar__subsection-icon,.sidebar__rail-icon').forEach((icon) => {
        icon.classList.toggle('has-lucide-svg', Boolean(icon.querySelector('svg')));
      });
      document.documentElement.classList.add('has-lucide-icons');
      return;
    }
    if (attempt < 8) setTimeout(() => scheduleLucideIcons(attempt + 1), 120);
  });
}

function bindPendingNoveltyBadge(container, deps = {}) {
  const badge = qs('#sidebarRegistroDiarioBadge', container);
  if (!badge || typeof deps.listEmployeeDailyStatusRange !== 'function') return () => {};

  let active = true;
  let refreshTimer = null;
  const unsubs = [];
  let employees = [];
  let sedes = [];
  let supernumerarios = [];
  let novedades = [];

  const setCount = (count) => {
    if (!active) return;
    const value = Math.max(0, Number(count || 0));
    badge.hidden = value <= 0;
    badge.textContent = value > 99 ? '99+' : String(value);
    const label = `${value} novedad${value === 1 ? '' : 'es'} pendiente${value === 1 ? '' : 's'} de gestionar`;
    badge.setAttribute('aria-label', label);
    const link = badge.closest('.sidebar__nav-link');
    if (link) {
      link.title = value > 0 ? `Registro Diario - ${label}` : 'Registro Diario';
      link.setAttribute('aria-label', link.title);
    }
  };

  const refresh = async () => {
    const day = todayBogota();
    const contratoCodigo = contractFilterCode();
    try {
      const [statusRows, attendanceRows, replacementRows] = await Promise.all([
        deps.listEmployeeDailyStatusRange(day, day, { contratoCodigo }),
        deps.listAttendanceRange?.(day, day, { contratoCodigo }) || [],
        deps.listImportReplacementsRange?.(day, day, { contratoCodigo }) || []
      ]);
      if (!active) return;
      const pending = countPendingManagedNovelties({
        day,
        statusRows,
        attendanceRows,
        replacementRows,
        employees: scopeSidebarRows(employees),
        sedes: scopeSidebarRows(sedes),
        supernumerarios: scopeSidebarRows(supernumerarios),
        novedades
      });
      setCount(pending);
    } catch (error) {
      if (!active) return;
      setCount(0);
      console.warn('No se pudo actualizar la burbuja de novedades pendientes:', error);
    }
  };

  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 250);
  };

  refresh();
  if (typeof deps.streamAttendanceByDate === 'function') {
    unsubs.push(deps.streamAttendanceByDate(todayBogota(), scheduleRefresh, scheduleRefresh));
  }
  if (typeof deps.streamImportReplacementsByDate === 'function') {
    unsubs.push(deps.streamImportReplacementsByDate(todayBogota(), scheduleRefresh, scheduleRefresh));
  }
  if (typeof deps.streamDailyMetricsByDate === 'function') {
    unsubs.push(deps.streamDailyMetricsByDate(todayBogota(), scheduleRefresh, scheduleRefresh));
  }
  const employeeStream = typeof deps.streamCurrentEmployees === 'function' ? deps.streamCurrentEmployees : deps.streamEmployees;
  if (typeof employeeStream === 'function') {
    unsubs.push(employeeStream((rows) => { employees = rows || []; scheduleRefresh(); }, null, null, todayBogota()));
  }
  if (typeof deps.streamSedes === 'function') {
    unsubs.push(deps.streamSedes((rows) => { sedes = rows || []; scheduleRefresh(); }));
  }
  if (typeof deps.streamSupernumerarios === 'function') {
    unsubs.push(deps.streamSupernumerarios((rows) => { supernumerarios = rows || []; scheduleRefresh(); }, todayBogota()));
  }
  if (typeof deps.streamNovedades === 'function') {
    unsubs.push(deps.streamNovedades((rows) => { novedades = rows || []; scheduleRefresh(); }));
  }
  unsubs.push(subscribe('selectedContractCode', scheduleRefresh));

  return () => {
    active = false;
    if (refreshTimer) clearTimeout(refreshTimer);
    unsubs.forEach((un) => un?.());
  };
}

function bindFreeSupernumerariosBadge(container, deps = {}) {
  const badge = qs('#sidebarSupernumerariosFreeBadge', container);
  if (!badge) return () => {};
  badge.hidden = false;
  badge.textContent = '0';
  if (typeof deps.streamSupernumerarios !== 'function') return () => {};

  let active = true;
  let refreshTimer = null;
  const unsubs = [];
  let supernumerarios = [];
  let incapacitados = [];
  let occupancyRows = [];

  const setCount = (count) => {
    if (!active) return;
    const value = Math.max(0, Number(count || 0));
    badge.hidden = false;
    badge.classList.toggle('sidebar__nav-badge--ok', value > 0);
    badge.textContent = value > 99 ? '99+' : String(value);
    const label = `${value} supernumerario${value === 1 ? '' : 's'} libre${value === 1 ? '' : 's'} hoy`;
    badge.setAttribute('aria-label', label);
    const link = badge.closest('.sidebar__nav-link');
    if (link) {
      link.title = value > 0 ? `Supernumerarios - ${label}` : 'Supernumerarios';
      link.setAttribute('aria-label', link.title);
    }
  };

  const refreshCount = () => {
    const day = todayBogota();
    const scopedSupernumerarios = scopeSidebarRows(supernumerarios);
    const incapKeys = supernumerarioIncapacityKeys(scopeSidebarRows(incapacitados));
    const occupiedKeys = supernumerarioOccupancyKeys(scopeSidebarRows(occupancyRows));
    const free = (scopedSupernumerarios || []).filter((row) => {
      if (!isAvailableSupernumerarioForBadge(row, day)) return false;
      const keys = supernumerarioPersonKeys(row);
      if (keys.some((key) => incapKeys.has(key))) return false;
      if (keys.some((key) => occupiedKeys.has(key))) return false;
      return true;
    }).length;
    setCount(free);
  };

  const refreshOccupancy = async () => {
    const day = todayBogota();
    const contratoCodigo = contractFilterCode();
    try {
      if (typeof deps.listSupernumerarioReplacementOccupancy === 'function') {
        occupancyRows = scopeSidebarRows(await deps.listSupernumerarioReplacementOccupancy(day) || []);
      } else if (typeof deps.listImportReplacementsRange === 'function') {
        occupancyRows = (await deps.listImportReplacementsRange(day, day, { contratoCodigo }) || [])
          .filter((row) => String(row?.decision || '').trim() === 'reemplazo');
      }
      refreshCount();
    } catch (error) {
      console.warn('No se pudo actualizar la burbuja de supernumerarios libres:', error);
      occupancyRows = [];
      refreshCount();
    }
  };

  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshOccupancy, 250);
  };

  unsubs.push(deps.streamSupernumerarios((rows) => {
    supernumerarios = rows || [];
    refreshCount();
  }, todayBogota()));
  if (typeof deps.streamIncapacitadosByDate === 'function') {
    unsubs.push(deps.streamIncapacitadosByDate(todayBogota(), (rows) => {
      incapacitados = rows || [];
      refreshCount();
    }));
  }
  if (typeof deps.streamImportReplacementsByDate === 'function') {
    unsubs.push(deps.streamImportReplacementsByDate(todayBogota(), scheduleRefresh, scheduleRefresh));
  }
  refreshOccupancy();
  unsubs.push(subscribe('selectedContractCode', scheduleRefresh));

  return () => {
    active = false;
    if (refreshTimer) clearTimeout(refreshTimer);
    unsubs.forEach((un) => un?.());
  };
}

function bindShiftReviewBadge(container, deps = {}) {
  const badge = qs('#sidebarShiftReviewBadge', container);
  if (!badge || typeof deps.listEmployeeShiftStatusRange !== 'function') return () => {};

  let active = true;
  let refreshTimer = null;
  let intervalId = null;

  const setCount = (count) => {
    if (!active) return;
    const value = Math.max(0, Number(count || 0));
    badge.hidden = value <= 0;
    badge.textContent = value > 99 ? '99+' : String(value);
    const label = `${value} pendiente${value === 1 ? '' : 's'} de revision de turnos`;
    badge.setAttribute('aria-label', label);
    const link = badge.closest('.sidebar__nav-link');
    if (link) {
      link.title = value > 0 ? `Revision de turnos - ${label}` : 'Revision de turnos';
      link.setAttribute('aria-label', link.title);
    }
  };

  const refresh = async () => {
    const dateTo = todayBogota();
    const dateFrom = addIsoDays(dateTo, -30);
    try {
      const rows = await deps.listEmployeeShiftStatusRange(dateFrom, dateTo, { contratoCodigo: contractFilterCode(), reviewableOnly: true });
      if (!active) return;
      setCount((rows || []).filter(isPendingShiftReviewForBadge).length);
    } catch (error) {
      if (!active) return;
      setCount(0);
      console.warn('No se pudo actualizar la burbuja de revision de turnos:', error);
    }
  };

  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 250);
  };

  refresh();
  intervalId = setInterval(scheduleRefresh, 60000);
  const unSelectedContract = subscribe('selectedContractCode', scheduleRefresh);

  return () => {
    active = false;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (intervalId) clearInterval(intervalId);
    try { unSelectedContract?.(); } catch {}
  };
}

function scopeSidebarRows(rows = []) {
  const code = contractFilterCode();
  if (!code) return rows || [];
  return (rows || []).filter((row) => contractMatches(row, code));
}

function isPendingShiftReviewForBadge(row = {}) {
  return isReviewableShiftStatus(row);
}

function isAvailableSupernumerarioForBadge(row = {}, day = '') {
  const estado = String(row?.estado || 'activo').trim().toLowerCase();
  if (estado === 'eliminado') return false;
  return isPersonActiveForBadgeDate(row, day, { allowMissingIngreso: true });
}

function supernumerarioPersonKeys(row = {}) {
  return [
    String(row?.id || row?.employeeId || '').trim() ? `id:${String(row?.id || row?.employeeId || '').trim()}` : '',
    String(row?.documento || '').trim() ? `doc:${String(row?.documento || '').trim()}` : ''
  ].filter(Boolean);
}

function supernumerarioIncapacityKeys(rows = []) {
  const keys = new Set();
  (rows || []).forEach((row) => {
    const id = String(row?.employeeId || '').trim();
    const doc = String(row?.documento || '').trim();
    if (id) keys.add(`id:${id}`);
    if (doc) keys.add(`doc:${doc}`);
  });
  return keys;
}

function supernumerarioOccupancyKeys(rows = []) {
  const keys = new Set();
  (rows || []).forEach((row) => {
    if (String(row?.decision || 'reemplazo').trim() !== 'reemplazo') return;
    const id = String(row?.supernumerarioId || '').trim();
    const doc = String(row?.supernumerarioDocumento || '').trim();
    if (id) keys.add(`id:${id}`);
    if (doc) keys.add(`doc:${doc}`);
  });
  return keys;
}

function isPendingManagedNovelty(row = {}) {
  return String(row?.tipoPersonal || '').trim() === 'empleado'
    && row?.servicioProgramado === true
    && String(row?.decisionCobertura || '').trim() === 'pendiente';
}

function countPendingManagedNovelties({
  day,
  statusRows = [],
  attendanceRows = [],
  replacementRows = [],
  employees = [],
  sedes = [],
  supernumerarios = [],
  novedades = []
} = {}) {
  const pendingStatusKeys = new Set();
  (statusRows || []).filter(isPendingManagedNovelty).forEach((row) => {
    const key = dailyPersonKey(row);
    if (key) pendingStatusKeys.add(key);
  });

  const statusByKey = new Map();
  (statusRows || []).forEach((row) => {
    const key = dailyPersonKey(row);
    if (key) statusByKey.set(key, row);
  });

  const handledReplacementKeys = new Set();
  (replacementRows || []).forEach((row) => {
    const decision = String(row?.decision || '').trim();
    if (!['reemplazo', 'ausentismo'].includes(decision)) return;
    const key = dailyPersonKey(row);
    if (key) handledReplacementKeys.add(key);
  });
  handledReplacementKeys.forEach((key) => pendingStatusKeys.delete(key));

  const pendingAttendanceKeys = new Set();
  (attendanceRows || []).forEach((row) => {
    const key = dailyPersonKey(row);
    if (!key || handledReplacementKeys.has(key)) return;
    if (isSupernumerarioAttendanceForBadge(row, supernumerarios, day)) return;
    if (!isAttendanceReplacementNovelty(row, novedades)) return;
    if (!rowHasScheduledServiceForBadge(row, statusByKey, employees, sedes, day)) return;
    pendingAttendanceKeys.add(key);
  });

  return new Set([...pendingStatusKeys, ...pendingAttendanceKeys]).size;
}

function dailyPersonKey(row = {}) {
  const fecha = String(row?.fecha || row?.fechaOperacion || '').trim();
  const employeeId = String(row?.employeeId || row?.empleadoId || '').trim();
  const documento = String(row?.documento || '').trim();
  if (!fecha || (!employeeId && !documento)) return '';
  return `${fecha}|${employeeId || `doc:${documento}`}`;
}

function isAttendanceReplacementNovelty(row = {}, novedades = []) {
  const raw = String(row?.novedadNombre || row?.novedad || '').trim();
  const code = String(row?.novedadCodigo || (/^\d+$/.test(raw) ? raw : '')).trim();
  if ((!raw && !code) || code === '1' || raw === '1' || code === '7') return false;
  if (['2', '3', '4', '5', '8', '9'].includes(code)) return true;
  const normalizedRaw = normalizeBadgeText(baseNovedadName(raw || code));
  if (!normalizedRaw || normalizedRaw.startsWith('otra sede')) return false;

  const catalog = (novedades || []).find((item) => {
    const itemName = normalizeBadgeText(item?.nombre || '');
    const itemCode = normalizeBadgeText(item?.codigoNovedad || item?.codigo || '');
    return (code && itemCode === normalizeBadgeText(code))
      || (normalizedRaw && (
        (itemName && (itemName === normalizedRaw || itemName.includes(normalizedRaw) || normalizedRaw.includes(itemName)))
        || (itemCode && itemCode === normalizedRaw)
      ));
  });
  if (catalog) return ['si', 'yes', 'true', '1', 'reemplazo'].includes(normalizeBadgeText(catalog?.reemplazo || ''));

  return normalizedRaw.includes('incapacidad')
    || normalizedRaw.includes('accidente laboral')
    || normalizedRaw.includes('calamidad')
    || normalizedRaw.includes('vacaciones')
    || normalizedRaw.includes('permiso no remunerado');
}

function rowHasScheduledServiceForBadge(row = {}, statusByKey = new Map(), employees = [], sedes = [], day = '') {
  const status = statusByKey.get(dailyPersonKey(row));
  if (status) return status.servicioProgramado === true;
  const employeeId = String(row?.empleadoId || row?.employeeId || '').trim();
  const documento = String(row?.documento || '').trim();
  const employee = (employees || []).find((item) => {
    if (employeeId && String(item?.id || '').trim() === employeeId) return true;
    return documento && String(item?.documento || '').trim() === documento;
  });
  return employee ? isEmployeeExpectedForBadgeDate(employee, day, sedes) : false;
}

function isSupernumerarioAttendanceForBadge(row = {}, supernumerarios = [], day = '') {
  const doc = String(row?.documento || '').trim();
  if (!doc) return false;
  return (supernumerarios || []).some((item) => {
    if (String(item?.documento || '').trim() !== doc) return false;
    return isPersonActiveForBadgeDate(item, day, { allowMissingIngreso: true });
  });
}

function isEmployeeExpectedForBadgeDate(employee = {}, day = '', sedes = []) {
  if (!isPersonActiveForBadgeDate(employee, day)) return false;
  const sedeCodigo = String(employee?.sedeCodigo || '').trim();
  if (!sedeCodigo) return false;
  const sede = (sedes || []).find((row) => String(row?.codigo || '').trim() === sedeCodigo) || null;
  return isSedeScheduledForBadgeDate(sede, day);
}

function isPersonActiveForBadgeDate(person = {}, day = '', options = {}) {
  const ingreso = toBadgeIsoDate(person?.fechaIngreso);
  if (ingreso && ingreso > day) return false;
  if (!ingreso && options?.allowMissingIngreso !== true) return false;
  const retiro = toBadgeIsoDate(person?.fechaRetiro);
  const estado = String(person?.estado || 'activo').trim().toLowerCase();
  if (estado === 'inactivo') return Boolean(retiro && retiro >= day);
  if (estado === 'eliminado') return false;
  if (retiro && retiro < day) return false;
  return true;
}

function isSedeScheduledForBadgeDate(sede = null, day = '') {
  if (!sede || !day) return false;
  const [year, month, date] = day.split('-').map((value) => Number(value));
  const weekday = new Date(Date.UTC(year, (month || 1) - 1, date || 1)).getUTCDay();
  const jornada = String(sede?.jornada || 'lun_vie').trim().toLowerCase();
  if (jornada === 'lun_dom') return true;
  if (jornada === 'lun_sab') return weekday >= 1 && weekday <= 6;
  return weekday >= 1 && weekday <= 5;
}

function baseNovedadName(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  const noParens = raw.replace(/\s*\(.*\)\s*$/, '').trim();
  if (/^OTRA\s+SEDE\s*:/i.test(noParens)) return 'OTRA SEDE';
  return noParens;
}

function normalizeBadgeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toBadgeIsoDate(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }
  const parsed = value instanceof Date ? value : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}

function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function addIsoDays(isoDate, days) {
  const raw = String(isoDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return raw;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function getSectionPref(key) {
  try {
    return localStorage.getItem(`sidebar_sec_${key}`) === '1';
  } catch (_) {
    return false;
  }
}

function setSectionPref(key, collapsed) {
  try {
    localStorage.setItem(`sidebar_sec_${key}`, collapsed ? '1' : '0');
  } catch (_) {}
}

function getCurrentRoute() {
  return (window.location.hash || '#/login').replace('#', '').split('?')[0];
}

function getSectionIconMeta(key) {
  const map = {
    gobierno: { icon: 'shield-check', fallback: 'GO' },
    administracion: { icon: 'building-2', fallback: 'AD' },
    sedes: { icon: 'map-pinned', fallback: 'SD' },
    turnos: { icon: 'calendar-clock', fallback: 'TU' },
    empleados: { icon: 'users', fallback: 'EM' },
    operacion: { icon: 'clipboard-check', fallback: 'OP' },
    reportes: { icon: 'file-bar-chart', fallback: 'RP' },
    cargue_masivo: { icon: 'upload', fallback: 'CM' }
  };
  return map[key] || { icon: 'folder', fallback: '>>' };
}

function getSubsectionIconMeta(key) {
  const map = {
    turnos: { icon: 'calendar-clock', fallback: 'TU' },
    reportes_diarios: { icon: 'calendar-days', fallback: 'D' },
    reportes_consolidados: { icon: 'files', fallback: 'C' },
    admin: { icon: 'building-2', fallback: 'AD' },
    administracion: { icon: 'building-2', fallback: 'AD' },
    sedes: { icon: 'map-pinned', fallback: 'SD' },
    personal: { icon: 'users', fallback: 'PE' },
    operacion: { icon: 'clipboard-check', fallback: 'OP' },
    reportes: { icon: 'file-bar-chart', fallback: 'RP' },
    inventory: { icon: 'package', fallback: 'IN' },
    cargue: { icon: 'upload', fallback: 'CM' }
  };
  if (map[key]) return map[key];
  const normalized = String(key || '').replace(/^contract_/, '').replace(/_[^_]+$/, '');
  return map[normalized] || { icon: 'folder-open', fallback: '-' };
}

function getNavIconMeta(route) {
  if (route.endsWith('-dashboard')) return { icon: 'layout-dashboard', fallback: 'DB' };
  const map = {
    '/contract-dashboard': { icon: 'layout-dashboard', fallback: 'RE' },
    '/permissions': { icon: 'shield-check', fallback: 'CP' },
    '/permissions-audit': { icon: 'clipboard-list', fallback: 'AU' },
    '/users': { icon: 'settings', fallback: 'US' },
    '/zones': { icon: 'map', fallback: 'ZN' },
    '/contracts': { icon: 'briefcase-business', fallback: 'CT' },
    '/contract-details': { icon: 'file-text', fallback: 'CT' },
    '/inventory': { icon: 'package', fallback: 'IN' },
    '/inventory/products': { icon: 'boxes', fallback: 'BP' },
    '/inventory/deliveries': { icon: 'truck', fallback: 'EN' },
    '/dependencies': { icon: 'network', fallback: 'DP' },
    '/sedes': { icon: 'building-2', fallback: 'SD' },
    '/sedes-ubicacion': { icon: 'map-pinned', fallback: 'US' },
    '/cargos': { icon: 'briefcase', fallback: 'CG' },
    '/novedades': { icon: 'list-checks', fallback: 'NV' },
    '/employees': { icon: 'users', fallback: 'EM' },
    '/employee-novelties': { icon: 'history', fallback: 'NE' },
    '/supervisors': { icon: 'user-check', fallback: 'SP' },
    '/supernumerarios': { icon: 'user-plus', fallback: 'SN' },
    '/bulk-upload-sedes': { icon: 'building', fallback: 'BS' },
    '/bulk-upload': { icon: 'file-up', fallback: 'BE' },
    '/bulk-update-employees': { icon: 'file-pen-line', fallback: 'AE' },
    '/imports': { icon: 'message-circle', fallback: 'WA' },
    '/whatsapp-live': { icon: 'message-circle', fallback: 'WA' },
    '/registros-vivo': { icon: 'message-circle', fallback: 'WA' },
    '/turnos': { icon: 'calendar-clock', fallback: 'TU' },
    '/turnos-planes': { icon: 'calendar-clock', fallback: 'TP' },
    '/turnos-generados': { icon: 'calendar-check', fallback: 'TG' },
    '/turnos-rotaciones': { icon: 'repeat-2', fallback: 'RT' },
    '/turnos-visitas': { icon: 'map-pinned', fallback: 'VI' },
    '/turnos-revision': { icon: 'clipboard-check', fallback: 'RT' },
    '/registro-sede': { icon: 'clipboard-list', fallback: 'RS' },
    '/lector-qr': { icon: 'scan-line', fallback: 'QR' },
    '/tablets-qr': { icon: 'tablet', fallback: 'TQ' },
    '/registro-qr': { icon: 'qr-code', fallback: 'RQ' },
    '/import-history': { icon: 'clock-3', fallback: 'HI' },
    '/absenteeism': { icon: 'user-x', fallback: 'AU' },
    '/reports': { icon: 'file-bar-chart', fallback: 'RP' },
    '/reports-client': { icon: 'file-bar-chart', fallback: 'RC' },
    '/reports-company': { icon: 'file-spreadsheet', fallback: 'RE' },
    '/reports-daily-history': { icon: 'calendar-check', fallback: 'HR' },
    '/reports-qr-history': { icon: 'file-search', fallback: 'HQ' },
    '/reports-employees': { icon: 'file-text', fallback: 'EM' },
    '/reports-hiring': { icon: 'file-spreadsheet', fallback: 'CS' },
    '/reports-novelties-consolidated': { icon: 'file-warning', fallback: 'CN' },
    '/reports-services-consolidated': { icon: 'table', fallback: 'CS' },
    '/reports-consolidated': { icon: 'files', fallback: 'RC' },
    '/upload': { icon: 'file-heart', fallback: 'IN' }
  };
  return map[route] || { icon: 'circle', fallback: '>>' };
}

function getSidebarCollapsedPref() {
  try {
    return localStorage.getItem('sidebar_collapsed') === '1';
  } catch (_) {
    return false;
  }
}

function setSidebarCollapsedPref(collapsed) {
  try {
    localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
  } catch (_) {}
}

function toggleCurrentSidebarPanel(sameContext) {
  const collapsed = document.getElementById('app-sidebar')?.getAttribute('data-collapsed') === 'true';
  const nextCollapsed = sameContext ? !collapsed : false;
  applySidebarCollapsed(nextCollapsed);
  setSidebarCollapsedPref(nextCollapsed);
  return sameContext;
}

function applySidebarCollapsed(collapsed) {
  const aside = document.getElementById('app-sidebar');
  const layout = document.querySelector('.app-layout');
  if (aside) aside.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  if (layout) layout.setAttribute('data-sidebar-collapsed', collapsed ? 'true' : 'false');
  aside?.querySelectorAll('[aria-controls="sidebar-context-panel"]').forEach((button) => {
    const active = button.classList.contains('is-active') || (button.classList.contains('sidebar__rail-logo') && !isSettingsMode());
    button.setAttribute('aria-expanded', String(active && !collapsed));
  });
}

function applySidebarKind(isDouble) {
  const aside = document.getElementById('app-sidebar');
  const layout = document.querySelector('.app-layout');
  const value = isDouble ? 'double' : 'rail';
  if (aside) aside.setAttribute('data-sidebar-kind', value);
  if (layout) layout.setAttribute('data-sidebar-kind', value);
}

export function isMobileSidebarOpen() {
  const aside = document.getElementById('app-sidebar');
  return aside?.getAttribute('data-mobile-open') === 'true';
}

export function toggleMobileSidebar() {
  setMobileSidebarOpen(!isMobileSidebarOpen());
}

export function closeMobileSidebar() {
  setMobileSidebarOpen(false);
}

function setMobileSidebarOpen(open) {
  const aside = document.getElementById('app-sidebar');
  const layout = document.querySelector('.app-layout');
  const backdrop = document.getElementById('app-sidebar-backdrop');
  const mobileToggle = document.querySelector('.header-mobile-toggle');
  const next = open ? 'true' : 'false';
  if (aside) aside.setAttribute('data-mobile-open', next);
  if (layout) layout.setAttribute('data-sidebar-mobile-open', next);
  if (backdrop) {
    backdrop.hidden = !open;
    backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (mobileToggle) {
    mobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    mobileToggle.textContent = open ? '✕' : '☰';
    mobileToggle.title = open ? 'Cerrar menu' : 'Abrir menu';
    mobileToggle.setAttribute('aria-label', mobileToggle.title);
  }
  document.body.classList.toggle('sidebar-mobile-open', open);
  document.dispatchEvent(new CustomEvent('sidebar-mobile-statechange', { detail: { open } }));
}

function ensureMobileSidebarState() {
  if (!isMobileViewport()) {
    closeMobileSidebar();
    return;
  }
  setMobileSidebarOpen(false);
}

function bindSidebarBackdrop() {
  const backdrop = document.getElementById('app-sidebar-backdrop');
  if (!backdrop || backdrop.dataset.bound === '1') return;
  backdrop.dataset.bound = '1';
  backdrop.addEventListener('click', () => closeMobileSidebar());
  window.addEventListener('resize', () => {
    if (!isMobileViewport()) closeMobileSidebar();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMobileSidebar();
  });
}

function isMobileViewport() {
  try {
    return window.matchMedia(MOBILE_BREAKPOINT).matches;
  } catch (_) {
    return window.innerWidth <= 900;
  }
}
