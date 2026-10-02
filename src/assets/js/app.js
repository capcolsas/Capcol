import { Header } from './components/Header.js';
import { Footer } from './components/Footer.js';
import { Sidebar, firstAvailableProjectRoute } from './components/Sidebar.js';

import { shareContractStream, shareContractImageUrls } from './utils/sharedContractData.js';

import { addRoute, startRouter, navigate, refreshRoute } from './router.js';
import { getState, setState, subscribe } from './state.js';
import { can, PERMS, isSuperAdmin } from './permissions.js';
import { ROLES } from './roles.js';
import { installBrowserAlertReplacement } from './utils/notifications.js';
installBrowserAlertReplacement();
const sidebarMount=document.getElementById('app-sidebar');
const headerMount =document.getElementById('app-header');
const footerMount =document.getElementById('app-footer');
const root        =document.getElementById('app-root');

let deps={};
function renderSidebar(){
  const current=sidebarMount.firstElementChild;
  current?._cleanup?.();
  sidebarMount.replaceChildren(Sidebar(deps));
}
function renderHeader(){
  const current=headerMount.firstElementChild;
  current?._cleanup?.();
  headerMount.replaceChildren(Header(deps));
}
renderSidebar();
renderHeader();
footerMount.replaceChildren(Footer());
subscribe('userProfile', () => footerMount.replaceChildren(Footer()));

let unsubRoleMatrix=null; let unsubUserOverrides=null; let unsubAudit=null;
let authSyncToken = 0;
let routerStarted = false;
let sidebarReadyWithDeps = false;
const PUBLIC_AUTH_ROUTES = new Set(['/login', '/forgot-password', '/reset-password']);
const REPORT_VIEW_PERMISSIONS = [
  PERMS.VIEW_REPORTS_CLIENT,
  PERMS.VIEW_REPORTS_QR_HISTORY,
  PERMS.VIEW_REPORTS_ABSENTEEISM,
  PERMS.VIEW_REPORTS_EMPLOYEES,
  PERMS.VIEW_REPORTS_HIRING,
  PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED,
  PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED
];
const CONSOLIDATED_REPORT_VIEW_PERMISSIONS = [
  PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED,
  PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED
];
const guardWrite=(perm,fn)=> async (...args)=>{
  if(typeof fn!=='function') return undefined;
  if(!can(perm)) throw new Error('No tienes permiso de edicion para esta seccion.');
  return fn(...args);
};

(function init(){
  import('./supabase.js')
    .then((fb) => {
      const contractScope = () => {
        const state = getState();
        return JSON.stringify([state.user?.uid, state.userProfile]);
      };
      const sharedContracts = shareContractStream(fb.streamContracts, contractScope);
      const sharedContractImages = shareContractImageUrls(fb.getContractReferenceImageUrl, contractScope);
      deps={
        authState:fb.authState, login:fb.login, register:fb.register, logout:fb.logout,
        requestPasswordReset:fb.requestPasswordReset, updatePassword:fb.updatePassword,
        ensureUserProfile:fb.ensureUserProfile, loadUserProfile:fb.loadUserProfile, createUserProfile:fb.createUserProfile,
        addNote:fb.addNote, streamNotes:fb.streamNotes,
        streamRoleMatrix:fb.streamRoleMatrix, setRolePermissions:fb.setRolePermissions, streamUserOverrides:fb.streamUserOverrides,
        getUserOverrides:fb.getUserOverrides, setUserOverrides:fb.setUserOverrides, clearUserOverrides:fb.clearUserOverrides,
        addAuditLog:fb.addAuditLog, streamAuditLogs:(cb,max)=>{ if(unsubAudit)unsubAudit(); unsubAudit=fb.streamAuditLogs(cb,max); return unsubAudit; }, streamAuditLogsByKind:fb.streamAuditLogsByKind, listEmployeeAuditLogsRange:fb.listEmployeeAuditLogsRange,
        streamUsers:fb.streamUsers, setUserRole:guardWrite(PERMS.EDIT_USERS,fb.setUserRole), syncSupervisorAccessForUser:guardWrite(PERMS.EDIT_USERS,fb.syncSupervisorAccessForUser), setUserStatus:guardWrite(PERMS.EDIT_USERS,fb.setUserStatus), findUserByEmail:fb.findUserByEmail,
        loadInventory:fb.loadInventory, createInventoryProduct:guardWrite(PERMS.MANAGE_INVENTORY,fb.createInventoryProduct), postInventory:fb.postInventory,
        loadVisits:fb.loadVisits, saveVisitSettings:guardWrite(PERMS.EDIT_CONTRACTS,fb.saveVisitSettings), reviewVisit:guardWrite(PERMS.EDIT_CONTRACTS,fb.reviewVisit), getVisitPhotoUrl:fb.getVisitPhotoUrl,
        streamProfileContractAccess:fb.streamProfileContractAccess, setUserContractAccess:guardWrite(PERMS.EDIT_USERS,fb.setUserContractAccess),
        getContractReferenceImageUrl:sharedContractImages, saveContractReferenceImage:guardWrite(PERMS.EDIT_CONTRACTS,fb.saveContractReferenceImage),
        streamContracts:sharedContracts, countActiveContracts:fb.countActiveContracts, createContract:guardWrite(PERMS.EDIT_CONTRACTS,fb.createContract), updateContract:guardWrite(PERMS.EDIT_CONTRACTS,fb.updateContract), setContractStatus:guardWrite(PERMS.EDIT_CONTRACTS,fb.setContractStatus), findContractByCode:fb.findContractByCode, getNextContractCode:fb.getNextContractCode,
        streamZones:fb.streamZones, createZone:guardWrite(PERMS.EDIT_ZONES,fb.createZone), updateZone:guardWrite(PERMS.EDIT_ZONES,fb.updateZone), setZoneStatus:guardWrite(PERMS.EDIT_ZONES,fb.setZoneStatus), findZoneByCode:fb.findZoneByCode, getNextZoneCode:fb.getNextZoneCode,
        streamDependencies:fb.streamDependencies, createDependency:guardWrite(PERMS.EDIT_DEPENDENCIES,fb.createDependency), updateDependency:guardWrite(PERMS.EDIT_DEPENDENCIES,fb.updateDependency), setDependencyStatus:guardWrite(PERMS.EDIT_DEPENDENCIES,fb.setDependencyStatus), findDependencyByCode:fb.findDependencyByCode, getNextDependencyCode:fb.getNextDependencyCode,
        streamSedes:fb.streamSedes, countActiveSedes:fb.countActiveSedes, createSede:guardWrite(PERMS.EDIT_SEDES,fb.createSede), updateSede:guardWrite(PERMS.EDIT_SEDES,fb.updateSede), setSedeStatus:guardWrite(PERMS.EDIT_SEDES,fb.setSedeStatus), findSedeByCode:fb.findSedeByCode, getNextSedeCode:fb.getNextSedeCode,
        streamShiftTemplates:fb.streamShiftTemplates, listShiftTemplates:fb.listShiftTemplates, createShiftTemplate:guardWrite(PERMS.MANAGE_SHIFT_PLANS,fb.createShiftTemplate), updateShiftTemplate:guardWrite(PERMS.MANAGE_SHIFT_PLANS,fb.updateShiftTemplate), setShiftTemplateStatus:guardWrite(PERMS.MANAGE_SHIFT_PLANS,fb.setShiftTemplateStatus),
        listShiftRotations:fb.listShiftRotations, previewShiftRotation:fb.previewShiftRotation, getShiftRotationRulesVersion:fb.getShiftRotationRulesVersion, listShiftOvertimeWeeks:fb.listShiftOvertimeWeeks, swapShiftRotationRestDays:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.swapShiftRotationRestDays), moveShiftRotationRestDay:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.moveShiftRotationRestDay), getShiftRotationReliefWeeks:fb.getShiftRotationReliefWeeks, moveShiftRotationSurplus:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.moveShiftRotationSurplus), replaceManualShiftAssignments:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.replaceManualShiftAssignments), saveShiftRotation:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.saveShiftRotation), applyShiftRotation:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.applyShiftRotation), pauseShiftRotation:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.pauseShiftRotation), deleteShiftRotation:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.deleteShiftRotation), updateShiftRotationRules:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.updateShiftRotationRules),
        listShiftTemplateRules:fb.listShiftTemplateRules, listShiftTemplateRuleCounts:fb.listShiftTemplateRuleCounts, streamShiftTemplateRules:fb.streamShiftTemplateRules, createShiftTemplateRule:guardWrite(PERMS.MANAGE_SHIFT_PLANS,fb.createShiftTemplateRule), updateShiftTemplateRule:guardWrite(PERMS.MANAGE_SHIFT_PLANS,fb.updateShiftTemplateRule), setShiftTemplateRuleStatus:guardWrite(PERMS.MANAGE_SHIFT_PLANS,fb.setShiftTemplateRuleStatus), saveShiftTemplateRules:guardWrite(PERMS.MANAGE_SHIFT_PLANS,fb.saveShiftTemplateRules),
        streamScheduledShiftsByDate:fb.streamScheduledShiftsByDate, listScheduledShiftsRange:fb.listScheduledShiftsRange, listShiftSitePlanAssignments:fb.listShiftSitePlanAssignments, activateShiftPlanForSites:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.activateShiftPlanForSites), renewActiveShiftPlans:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.renewActiveShiftPlans), generateScheduledShiftsFromPlans:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.generateScheduledShiftsFromPlans), createScheduledShift:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.createScheduledShift), updateScheduledShift:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.updateScheduledShift), setScheduledShiftStatus:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.setScheduledShiftStatus),
        listShiftAssignmentsByShift:fb.listShiftAssignmentsByShift, listShiftAssignmentsForShifts:fb.listShiftAssignmentsForShifts, listShiftAssignmentOverlapCandidates:fb.listShiftAssignmentOverlapCandidates, streamShiftAssignmentsByShift:fb.streamShiftAssignmentsByShift, upsertShiftAssignments:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.upsertShiftAssignments), updateShiftAssignment:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.updateShiftAssignment), removeShiftAssignment:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.removeShiftAssignment), removeShiftAssignments:guardWrite(PERMS.MANAGE_GENERATED_SHIFTS,fb.removeShiftAssignments),
        listEmployeeShiftStatusRange:fb.listEmployeeShiftStatusRange, upsertEmployeeShiftStatus:guardWrite(PERMS.MANAGE_SHIFT_REVIEW,fb.upsertEmployeeShiftStatus), listShiftClosuresRange:fb.listShiftClosuresRange,
        resolveShiftReviewDecision:guardWrite(PERMS.MANAGE_SHIFT_REVIEW,fb.resolveShiftReviewDecision),
        listPendingShiftAdjustments:fb.listPendingShiftAdjustments, createShiftAdjustment:guardWrite(PERMS.MANAGE_SHIFT_REVIEW,fb.createShiftAdjustment), updateShiftAdjustment:guardWrite(PERMS.MANAGE_SHIFT_REVIEW,fb.updateShiftAdjustment),
        listShiftTimeAuthorizations:fb.listShiftTimeAuthorizations, createShiftTimeAuthorization:guardWrite(PERMS.MANAGE_SHIFT_REVIEW,fb.createShiftTimeAuthorization), updateShiftTimeAuthorization:guardWrite(PERMS.MANAGE_SHIFT_REVIEW,fb.updateShiftTimeAuthorization),
        createQrDevice:guardWrite(PERMS.MANAGE_QR_DEVICES,fb.createQrDevice), setQrDeviceStatus:guardWrite(PERMS.MANAGE_QR_DEVICES,fb.setQrDeviceStatus), listQrDevices:fb.listQrDevices, streamQrDevices:fb.streamQrDevices, scanAttendanceQr:guardWrite(PERMS.USE_QR_SCANNER,fb.scanAttendanceQr), listDailyQrRecords:fb.listDailyQrRecords, streamDailyQrRecords:fb.streamDailyQrRecords,
        createSedesBulk:guardWrite(PERMS.BULK_UPLOAD_SEDES,fb.createSedesBulk),
        streamEmployees:fb.streamEmployees, countActiveEmployees:fb.countActiveEmployees, listEmployeesAdminPage:fb.listEmployeesAdminPage, watchEmployeesAdminChanges:fb.watchEmployeesAdminChanges, listCurrentEmployees:fb.listCurrentEmployees, listEmployeeDashboardPeople:fb.listEmployeeDashboardPeople, listEmployeesByIdentity:fb.listEmployeesByIdentity, getEmployeeLastAttendanceDay:fb.getEmployeeLastAttendanceDay, streamCurrentEmployees:fb.streamCurrentEmployees, streamActiveBaseEmployees:fb.streamActiveBaseEmployees, listActiveBaseEmployees:fb.listActiveBaseEmployees, createEmployee:guardWrite(PERMS.EDIT_EMPLOYEES,fb.createEmployee), rehireEmployee:guardWrite(PERMS.EDIT_EMPLOYEES,fb.rehireEmployee), updateEmployee:guardWrite(PERMS.EDIT_EMPLOYEES,fb.updateEmployee), setEmployeeStatus:guardWrite(PERMS.EDIT_EMPLOYEES,fb.setEmployeeStatus), updateProgrammedEmployeeAssignment:guardWrite(PERMS.MANAGE_EMPLOYEE_SCHEDULES,fb.updateProgrammedEmployeeAssignment), cancelProgrammedEmployeeAssignment:guardWrite(PERMS.MANAGE_EMPLOYEE_SCHEDULES,fb.cancelProgrammedEmployeeAssignment), findEmployeeByCode:fb.findEmployeeByCode, findEmployeeByDocument:fb.findEmployeeByDocument, getNextEmployeeCode:fb.getNextEmployeeCode,
        generateEmployeeCertificate:fb.generateEmployeeCertificate,
        listEmployeeRetirements:fb.listEmployeeRetirements,
        streamEmployeeCargoHistory:fb.streamEmployeeCargoHistory, streamEmployeeCargoHistoryAll:fb.streamEmployeeCargoHistoryAll, listEmployeeCargoHistoryRange:fb.listEmployeeCargoHistoryRange, listEmployeeCargoHistoryForEmployees:fb.listEmployeeCargoHistoryForEmployees,
        createEmployeesBulk:guardWrite(PERMS.BULK_UPLOAD_EMPLOYEES,fb.createEmployeesBulk), updateEmployeesBulk:guardWrite(PERMS.BULK_UPLOAD_EMPLOYEES,fb.updateEmployeesBulk),
        streamSupernumerarios:fb.streamSupernumerarios, listSupervisorAvailableSupernumerarios:fb.listSupervisorAvailableSupernumerarios, listSupernumerarioContractAccess:fb.listSupernumerarioContractAccess, setSupernumerarioContractAccess:guardWrite(PERMS.EDIT_SUPERNUMERARIOS,fb.setSupernumerarioContractAccess), createSupernumerario:guardWrite(PERMS.EDIT_SUPERNUMERARIOS,fb.createSupernumerario), updateSupernumerario:guardWrite(PERMS.EDIT_SUPERNUMERARIOS,fb.updateSupernumerario), setSupernumerarioStatus:guardWrite(PERMS.EDIT_SUPERNUMERARIOS,fb.setSupernumerarioStatus), findSupernumerarioByCode:fb.findSupernumerarioByCode, findSupernumerarioByDocument:fb.findSupernumerarioByDocument, getNextSupernumerarioCode:fb.getNextSupernumerarioCode,
        streamCargos:fb.streamCargos, streamContractCargos:fb.streamContractCargos, upsertContractCargo:guardWrite(PERMS.EDIT_CARGOS,fb.upsertContractCargo), countActiveCargos:fb.countActiveCargos, createCargo:guardWrite(PERMS.EDIT_CARGOS,fb.createCargo), updateCargo:guardWrite(PERMS.EDIT_CARGOS,fb.updateCargo), setCargoStatus:guardWrite(PERMS.EDIT_CARGOS,fb.setCargoStatus), findCargoByCode:fb.findCargoByCode, getNextCargoCode:fb.getNextCargoCode,
        streamNovedades:fb.streamNovedades, countActiveNovedades:fb.countActiveNovedades, createNovedad:guardWrite(PERMS.EDIT_NOVEDADES,fb.createNovedad), updateNovedad:guardWrite(PERMS.EDIT_NOVEDADES,fb.updateNovedad), setNovedadStatus:guardWrite(PERMS.EDIT_NOVEDADES,fb.setNovedadStatus), findNovedadByCode:fb.findNovedadByCode, findNovedadByCodigoNovedad:fb.findNovedadByCodigoNovedad, getNextNovedadCode:fb.getNextNovedadCode,
        streamSupervisors:fb.streamSupervisors, createSupervisor:guardWrite(PERMS.EDIT_SUPERVISORS,fb.createSupervisor), updateSupervisor:guardWrite(PERMS.EDIT_SUPERVISORS,fb.updateSupervisor), setSupervisorStatus:guardWrite(PERMS.EDIT_SUPERVISORS,fb.setSupervisorStatus), findSupervisorByCode:fb.findSupervisorByCode, findSupervisorByDocument:fb.findSupervisorByDocument, getNextSupervisorCode:fb.getNextSupervisorCode,
        confirmImportOperation:guardWrite(PERMS.MANAGE_OPERATION_REGISTRY,fb.confirmImportOperation), saveImportReplacements:guardWrite(PERMS.MANAGE_OPERATION_REGISTRY,fb.saveImportReplacements),
        isOperationDayClosed:fb.isOperationDayClosed, listClosedOperationDaysRange:fb.listClosedOperationDaysRange, listDailyClosuresRange:fb.listDailyClosuresRange,
        listDailySedeClosuresRange:fb.listDailySedeClosuresRange,
        listSedeStatusRange:fb.listSedeStatusRange, listAttendanceRange:fb.listAttendanceRange, listImportReplacementsRange:fb.listImportReplacementsRange, listSupernumerarioReplacementOccupancy:fb.listSupernumerarioReplacementOccupancy, listEmployeeDailyStatusRange:fb.listEmployeeDailyStatusRange,
        listDailyMetricsRange:fb.listDailyMetricsRange, listDailyContractMetricsRange:fb.listDailyContractMetricsRange,
        streamDailyMetricsByDate:fb.streamDailyMetricsByDate,
        streamIncapacitadosByDate:fb.streamIncapacitadosByDate,
        streamIncapacidades:fb.streamIncapacidades,
        uploadIncapacidadSupport:guardWrite(PERMS.MANAGE_INCAPACITIES,fb.uploadIncapacidadSupport),
        createIncapacidad:guardWrite(PERMS.MANAGE_INCAPACITIES,fb.createIncapacidad),
        updateIncapacidad:guardWrite(PERMS.MANAGE_INCAPACITIES,fb.updateIncapacidad),
        setIncapacidadStatus:guardWrite(PERMS.MANAGE_INCAPACITIES,fb.setIncapacidadStatus),
        listIncapacidadesRange:fb.listIncapacidadesRange,
        streamImportHistory:fb.streamImportHistory, streamDailyClosures:fb.streamDailyClosures, streamDailyClosuresRange:fb.streamDailyClosuresRange, streamWhatsAppIncoming:fb.streamWhatsAppIncoming,
        streamAttendanceByDate:fb.streamAttendanceByDate, streamAttendanceRecent:fb.streamAttendanceRecent, streamImportReplacementsByDate:fb.streamImportReplacementsByDate
      };

      fb.authState(async (user, authEvent)=>{
        const syncToken = ++authSyncToken;
        const prevUid = String(getState().user?.uid || '').trim();
        const nextUid = String(user?.uid || '').trim();
        const sameUser = Boolean(prevUid && nextUid && prevUid === nextUid);
        if(!sameUser){ if(unsubRoleMatrix){unsubRoleMatrix();unsubRoleMatrix=null;} if(unsubUserOverrides){unsubUserOverrides();unsubUserOverrides=null;} }
        if(!user){
          setState({ user:null, userProfile:null, userOverrides:{} });
          renderHeader();
          renderSidebar();
          if(authEvent==='PASSWORD_RECOVERY' || isRecoveryHash()) navigate('/reset-password');
          else if(!isPublicAuthRoute()) navigate('/login');
          else refreshRoute();
          return;
        }
        await fb.ensureUserProfile(user); const profile=await fb.loadUserProfile(user.uid);
        if(syncToken!==authSyncToken) return;
        const status=String(profile?.estado||'activo').toLowerCase();
        if(status==='inactivo' || status==='eliminado'){
          try{ sessionStorage.setItem('auth_block_msg', status==='eliminado' ? 'Tu usuario fue eliminado. Contacta al administrador.' : 'Tu usuario esta inactivo. Contacta al administrador.'); }catch{}
          await fb.logout();
          return;
        }
        if(String(profile?.role||'').trim().toLowerCase()===ROLES.TABLET_QR){
          window.location.replace('qr.html');
          return;
        }
        setState({ user, userProfile: profile });
        if(!sameUser || !unsubRoleMatrix) unsubRoleMatrix=fb.streamRoleMatrix((map)=> setState({ roleMatrix: map }));
        if(!sameUser || !unsubUserOverrides) unsubUserOverrides=fb.streamUserOverrides(user.uid,(ov)=> setState({ userOverrides: ov||{} }));
        if(!sameUser || !sidebarReadyWithDeps){ renderHeader(); renderSidebar(); sidebarReadyWithDeps = true; }
        if(authEvent==='PASSWORD_RECOVERY' || isRecoveryHash()) navigate('/reset-password');
        else if(location.hash==='' || location.hash==="#/login") navigate('/');
        else if(!sameUser) refreshRoute();
      });

      if(!routerStarted){
        startRouter();
        routerStarted = true;
      }
    })
    .catch((err) => {
      console.error('Supabase init failed:', err);
      if(!routerStarted){
        startRouter();
        routerStarted = true;
      }
    });

  addRoute('/login', async ()=> { const { Login } = await import('./components/Login.js'); return Login(root, deps); });
  addRoute('/forgot-password', async ()=> { const { ForgotPassword } = await import('./components/Login.js'); return ForgotPassword(root, deps); });
  addRoute('/reset-password', async ()=> { const { ResetPassword } = await import('./components/Login.js'); return ResetPassword(root, deps); });
  addRoute('/', ()=> requireAuth(()=> {
    const route = firstAvailableProjectRoute();
    setState({ sidebarContext: route === '/about' ? 'settings' : 'contract' });
    navigate(route);
    return null;
  }));
  addRoute('/information', ()=> requireAuth(async ()=> { const { Information } = await import('./components/Information.js'); return Information(root); }));
  addRoute('/contact', ()=> { navigate('/information'); return null; });
  addRoute('/data-treatment', ()=> requireAuth(async ()=> { const { DataTreatment } = await import('./components/DataTreatment.js'); return DataTreatment(root); }));
  addRoute('/about', ()=> requireAuth(async ()=> { const { About } = await import('./components/About.js'); return About(root); }));
  addRoute('/notes', ()=> requireAuth(async ()=> { const { Notes } = await import('./components/Notes.js'); return Notes(root); }));

  // Gobierno
  addRoute('/gobierno-dashboard', ()=> requireAuth(()=> guardAny([PERMS.VIEW_USERS, PERMS.VIEW_PERMISSIONS, PERMS.VIEW_AUDIT], async ()=> { const { GobiernoDashboard } = await import('./components/dashboards/GobiernoDashboard.js'); return GobiernoDashboard(root, deps); }, { allowSuperAdmin: true })));
  addRoute('/permissions', ()=> requireAuth(async ()=> { if(!isSuperAdmin() && !can(PERMS.VIEW_PERMISSIONS)) return block('No tienes permiso para acceder a esta sección.'); const { PermissionsCenter } = await import('./components/PermissionsCenter.js'); return PermissionsCenter(root, deps); }));
  addRoute('/permissions-audit', ()=> requireAuth(async ()=> { if(!isSuperAdmin() && !can(PERMS.VIEW_AUDIT)) return block('No tienes permiso para consultar auditoria.'); const { PermissionsAudit } = await import('./components/PermissionsAudit.js'); return PermissionsAudit(root, deps); }));

  // Administración
  addRoute('/users', ()=> requireAuth(()=> guard(PERMS.VIEW_USERS, async ()=> { const { UsersAdmin } = await import('./components/UsersAdmin.js'); return UsersAdmin(root, deps); })));
  addRoute('/contracts', ()=> requireAuth(()=> guard(PERMS.VIEW_CONTRACTS, async ()=> { const { ContractsAdmin } = await import('./components/ContractsAdmin.js'); return ContractsAdmin(root, deps); })));
  addRoute('/contract-details', ()=> requireAuth(()=> guard(PERMS.VIEW_CONTRACTS, async ()=> { const { ContractDetails } = await import('./components/ContractDetails.js'); return ContractDetails(root, deps); })));
  addRoute('/inventory', ()=> requireAuth(()=> guard(PERMS.VIEW_INVENTORY, async ()=> { const { Inventory } = await import('./components/Inventory.js'); return Inventory(root, deps); })));
  addRoute('/inventory/products', ()=> requireAuth(()=> guard(PERMS.VIEW_INVENTORY, async ()=> { const { Inventory } = await import('./components/Inventory.js'); return Inventory(root, deps, 'products'); })));
  addRoute('/inventory/deliveries', ()=> requireAuth(()=> guard(PERMS.VIEW_INVENTORY, async ()=> { const { Inventory } = await import('./components/Inventory.js'); return Inventory(root, deps, 'deliveries'); })));
  addRoute('/zones', ()=> requireAuth(()=> guard(PERMS.VIEW_ZONES, async ()=> { const { ZonesAdmin } = await import('./components/ZonesAdmin.js'); return ZonesAdmin(root, deps); })));
  addRoute('/dependencies', ()=> requireAuth(()=> guard(PERMS.VIEW_DEPENDENCIES, async ()=> { const { DependenciesAdmin } = await import('./components/DependenciesAdmin.js'); return DependenciesAdmin(root, deps); })));
  addRoute('/sedes', ()=> requireAuth(()=> guard(PERMS.VIEW_SEDES, async ()=> { const { SedesAdmin } = await import('./components/SedesAdmin.js'); return SedesAdmin(root, deps); })));
  addRoute('/sedes-ubicacion', ()=> requireAuth(()=> guard(PERMS.VIEW_SEDES, async ()=> { const { SedeLocationsAdmin } = await import('./components/SedeLocationsAdmin.js'); return SedeLocationsAdmin(root, deps); })));
  addRoute('/bulk-upload-sedes', ()=> requireAuth(()=> guard(PERMS.VIEW_BULK_UPLOAD_SEDES, async ()=> { const { CargueMasivoSedesAdmin } = await import('./components/CargueMasivoSedesAdmin.js'); return CargueMasivoSedesAdmin(root, deps); })));
  addRoute('/empleados-dashboard', ()=> requireAuth(()=> guardAny([PERMS.VIEW_EMPLOYEES, PERMS.VIEW_EMPLOYEE_NOVELTIES, PERMS.VIEW_SUPERVISORS, PERMS.VIEW_INCAPACITIES], async ()=> { const { EmpleadosDashboard } = await import('./components/dashboards/EmpleadosDashboard.js'); return EmpleadosDashboard(root, deps); })));
  addRoute('/employees', ()=> requireAuth(()=> guard(PERMS.VIEW_EMPLOYEES, async ()=> { const { EmployeesAdmin } = await import('./components/EmployeesAdmin.js'); return EmployeesAdmin(root, deps); })));
  addRoute('/employee-novelties', ()=> requireAuth(()=> guard(PERMS.VIEW_EMPLOYEE_NOVELTIES, async ()=> { const { EmployeeNovelties } = await import('./components/EmployeeNovelties.js'); return EmployeeNovelties(root, deps); })));
  addRoute('/supernumerarios', ()=> requireAuth(()=> guard(PERMS.VIEW_SUPERNUMERARIOS, async ()=> { const { SupernumerariosAdmin } = await import('./components/SupernumerariosAdmin.js'); return SupernumerariosAdmin(root, deps); })));
  addRoute('/bulk-upload', ()=> requireAuth(()=> guard(PERMS.VIEW_BULK_UPLOAD_EMPLOYEES, async ()=> { const { CargueMasivoAdmin } = await import('./components/CargueMasivoAdmin.js'); return CargueMasivoAdmin(root, deps); })));
  addRoute('/bulk-update-employees', ()=> requireAuth(()=> guard(PERMS.VIEW_BULK_UPLOAD_EMPLOYEES, async ()=> { const { EmployeeBulkUpdateAdmin } = await import('./components/EmployeeBulkUpdateAdmin.js'); return EmployeeBulkUpdateAdmin(root, deps); })));
  addRoute('/cargos', ()=> requireAuth(()=> guard(PERMS.VIEW_CARGOS, async ()=> { const { CargosAdmin } = await import('./components/CargosAdmin.js'); return CargosAdmin(root, deps); })));
  addRoute('/novedades', ()=> requireAuth(()=> guard(PERMS.VIEW_NOVEDADES, async ()=> { const { NovedadesAdmin } = await import('./components/NovedadesAdmin.js'); return NovedadesAdmin(root, deps); })));
  addRoute('/supervisors', ()=> requireAuth(()=> guard(PERMS.VIEW_SUPERVISORS, async ()=> { const { SupervisorsAdmin } = await import('./components/SupervisorsAdmin.js'); return SupervisorsAdmin(root, deps); })));
  addRoute('/turnos-planes', ()=> requireAuth(()=> guard(PERMS.VIEW_SHIFT_PLANS, async ()=> { const { ShiftPlansAdmin } = await import('./components/ShiftsAdmin.js'); return ShiftPlansAdmin(root, deps); })));
  addRoute('/turnos-generados', ()=> requireAuth(()=> guard(PERMS.VIEW_GENERATED_SHIFTS, async ()=> { const { GeneratedShiftsAdmin } = await import('./components/ShiftsAdmin.js'); return GeneratedShiftsAdmin(root, deps); })));
  addRoute('/turnos-calendario', ()=> requireAuth(()=> guard(PERMS.VIEW_GENERATED_SHIFTS, async ()=> { const { ShiftCalendarAdmin } = await import('./components/ShiftsAdmin.js'); return ShiftCalendarAdmin(root, deps); })));
  addRoute('/turnos-rotaciones', ()=> requireAuth(()=> guard(PERMS.MANAGE_GENERATED_SHIFTS, async ()=> { const { ShiftRotationsAdmin } = await import('./components/ShiftRotationsAdmin.js'); return ShiftRotationsAdmin(root, deps); })));
  addRoute('/turnos-visitas', ()=> requireAuth(()=> guard(PERMS.EDIT_CONTRACTS, async ()=> { const { SiteVisitsAdmin } = await import('./components/SiteVisitsAdmin.js'); return SiteVisitsAdmin(root, deps); })));
  addRoute('/turnos-revision', ()=> requireAuth(()=> guard(PERMS.VIEW_SHIFT_REVIEW, async ()=> { const { ShiftReviewAdmin } = await import('./components/ShiftsAdmin.js'); return ShiftReviewAdmin(root, deps); })));

  // Operación
  addRoute('/operacion-dashboard', ()=> requireAuth(()=> guardAny([PERMS.VIEW_OPERATION_REGISTRY, PERMS.VIEW_QR_DAILY_REGISTRY, PERMS.VIEW_SUPERNUMERARIOS, PERMS.VIEW_IMPORT_HISTORY], async ()=> { const { OperacionDashboard } = await import('./components/dashboards/OperacionDashboard.js'); return OperacionDashboard(root, deps); })));
  addRoute('/imports', ()=> { navigate('/registros-vivo'); return null; });
  addRoute('/whatsapp-live', ()=> { navigate('/registros-vivo'); return null; });
  addRoute('/registros-vivo', ()=> requireAuth(()=> guardAny([PERMS.VIEW_OPERATION_REGISTRY, PERMS.VIEW_QR_DAILY_REGISTRY], async ()=> { const { WhatsAppLive } = await import('./components/WhatsAppLive.js'); return WhatsAppLive(root, deps); })));
  addRoute('/turnos', ()=> {
    if (can(PERMS.VIEW_SHIFT_REVIEW)) { navigate('/turnos-revision'); return null; }
    if (can(PERMS.VIEW_GENERATED_SHIFTS)) { navigate('/turnos-generados'); return null; }
    if (can(PERMS.VIEW_SHIFT_PLANS)) { navigate('/turnos-planes'); return null; }
    if (can(PERMS.EDIT_CONTRACTS)) { navigate('/turnos-visitas'); return null; }
    return block('No tienes permiso para acceder a esta sección.');
  });
  addRoute('/registro-sede', ()=> requireAuth(()=> guard(PERMS.VIEW_OPERATION_REGISTRY, async ()=> { const { RegistroSede } = await import('./components/RegistroSede.js'); return RegistroSede(root, deps); })));
  addRoute('/lector-qr', ()=> requireAuth(()=> guard(PERMS.VIEW_QR_SCANNER, async ()=> { const { QrTabletScanner } = await import('./components/QrTabletScanner.js'); return QrTabletScanner(root, deps); })));
  addRoute('/tablets-qr', ()=> requireAuth(()=> guard(PERMS.VIEW_QR_DEVICES, async ()=> { const { QrDevicesInfo } = await import('./components/QrDevicesInfo.js'); return QrDevicesInfo(root, deps); })));
  addRoute('/registro-qr', ()=> { navigate('/registros-vivo'); return null; });
  addRoute('/imports-replacements', ()=> requireAuth(()=> guard(PERMS.VIEW_OPERATION_REGISTRY, async ()=> { const { ImportReplacements } = await import('./components/ImportReplacements.js'); return ImportReplacements(root, deps); })));
  addRoute('/import-history', ()=> requireAuth(()=> guard(PERMS.VIEW_IMPORT_HISTORY, async ()=> { const { ImportHistory } = await import('./components/ImportHistory.js'); return ImportHistory(root, deps); })));
  addRoute('/absenteeism', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_ABSENTEEISM, async ()=> { const { Absenteeism } = await import('./components/Absenteeism.js'); return Absenteeism(root, deps); })));

  // Consultor
  addRoute('/reportes-dashboard', ()=> requireAuth(()=> guardAny(REPORT_VIEW_PERMISSIONS, async ()=> { const { ReportesDashboard } = await import('./components/dashboards/ReportesDashboard.js'); return ReportesDashboard(root, deps); })));
  addRoute('/reports', ()=> requireAuth(()=> {
    if (can(PERMS.VIEW_REPORTS_CLIENT)) { navigate('/reports-daily-history'); return null; }
    if (can(PERMS.VIEW_REPORTS_QR_HISTORY)) { navigate('/reports-qr-history'); return null; }
    if (can(PERMS.VIEW_REPORTS_ABSENTEEISM)) { navigate('/absenteeism'); return null; }
    if (can(PERMS.VIEW_REPORTS_EMPLOYEES)) { navigate('/reports-employees'); return null; }
    if (can(PERMS.VIEW_REPORTS_HIRING)) { navigate('/reports-hiring'); return null; }
    if (can(PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED)) { navigate('/reports-novelties-consolidated'); return null; }
    if (can(PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED)) { navigate('/reports-services-consolidated'); return null; }
    return block('No tienes permiso para acceder a esta seccion.');
  }));
  addRoute('/reports-client', ()=> { navigate('/reports-daily-history'); return null; });
  addRoute('/reports-company', ()=> requireAuth(()=> guardAny(CONSOLIDATED_REPORT_VIEW_PERMISSIONS, ()=> {
    if (can(PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED)) { navigate('/reports-novelties-consolidated'); return null; }
    if (can(PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED)) { navigate('/reports-services-consolidated'); return null; }
    return block('No tienes permiso para acceder a esta seccion.');
  })));
  addRoute('/reports-daily', ()=> { navigate('/reports-daily-history'); return null; });
  addRoute('/reports-daily-history', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_CLIENT, async ()=> { const { HistoricalDailyRegistry } = await import('./components/HistoricalDailyRegistry.js'); return HistoricalDailyRegistry(root, deps); })));
  addRoute('/reports-qr-history', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_QR_HISTORY, async ()=> { const { HistoricalQrRegistry } = await import('./components/HistoricalQrRegistry.js'); return HistoricalQrRegistry(root, deps); })));
  addRoute('/reports-employees', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_EMPLOYEES, async ()=> { const { EmployeesReport } = await import('./components/EmployeesReport.js'); return EmployeesReport(root, deps); })));
  addRoute('/reports-hiring', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_HIRING, async ()=> { const { HiringBySedeReport } = await import('./components/HiringBySedeReport.js'); return HiringBySedeReport(root, deps); })));
  addRoute('/reports-novelties-consolidated', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED, async ()=> { const { ConsolidatedNoveltiesReport } = await import('./components/ConsolidatedNoveltiesReport.js'); return ConsolidatedNoveltiesReport(root, deps); })));
  addRoute('/reports-services-consolidated', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED, async ()=> { const { ConsolidatedReports } = await import('./components/ConsolidatedReports.js'); return ConsolidatedReports(root, deps); })));
  addRoute('/contract-dashboard', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_CLIENT, async ()=> { const { ContractDashboard } = await import('./components/ContractDashboard.js'); return ContractDashboard(root, deps); })));
  addRoute('/reports-contracts', ()=> requireAuth(()=> guard(PERMS.VIEW_REPORTS_CLIENT, async ()=> { const { ContractReports } = await import('./components/ContractReports.js'); return ContractReports(root, deps); })));
  addRoute('/reports-consolidated', ()=> requireAuth(()=> guardAny(CONSOLIDATED_REPORT_VIEW_PERMISSIONS, ()=> {
    if (can(PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED)) { navigate('/reports-novelties-consolidated'); return null; }
    if (can(PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED)) { navigate('/reports-services-consolidated'); return null; }
    return block('No tienes permiso para acceder a esta seccion.');
  })));

  // Supervisor/Empleado
  addRoute('/cargue-masivo-dashboard', ()=> requireAuth(()=> guardAny([PERMS.VIEW_BULK_UPLOAD_SEDES, PERMS.VIEW_BULK_UPLOAD_EMPLOYEES], async ()=> { const { CargueMasivoDashboard } = await import('./components/dashboards/CargueMasivoDashboard.js'); return CargueMasivoDashboard(root, deps); })));
  addRoute('/upload', ()=> requireAuth(()=> guard(PERMS.VIEW_INCAPACITIES, async ()=> { const { CargarDatos } = await import('./components/CargarDatos.js'); return CargarDatos(root, deps); })));
})();
function getRoutePath(){ return (window.location.hash || '#/login').replace('#', '').split('?')[0]; }
function isPublicAuthRoute(){ return PUBLIC_AUTH_ROUTES.has(getRoutePath()); }
function isRecoveryHash(){
  const urlMarkers = `${window.location.search || ''}&${window.location.hash || ''}`;
  return /(?:[?&#])reset_password=1\b|(?:[?&#])type=recovery\b|(?:[?&#])access_token=|(?:[?&#])code=/.test(urlMarkers);
}
function requireAuth(ok){ const { user }=getState(); if(!user){ navigate('/login'); return; } return ok?.(); }
function guard(perm, ok){ if(!can(perm)) return block('No tienes permiso para acceder a esta sección.'); return ok?.(); }
function guardAny(perms, ok, options = {}) {
  if (options?.allowSuperAdmin && isSuperAdmin()) return ok?.();
  if (!(perms || []).some((perm) => can(perm))) return block('No tienes permiso para acceder a esta sección.');
  return ok?.();
}
function block(text){ const div=document.createElement('div'); div.className='main-card'; div.innerHTML=`<h2 style="margin:0 0 .5rem 0;">RockyDEMO</h2><p>${text}</p>`; root.replaceChildren(div); return null; }
