
import { el } from '../utils/dom.js';
export const AuditStub=(mount)=>{ mount.replaceChildren(el('section',{className:'main-card'},[ el('h2',{},['Historial']), el('p',{},['Aquí irá el historial y auditoría para ADMIN/SUPERVISOR.']) ])); };
