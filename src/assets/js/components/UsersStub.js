
import { el } from '../utils/dom.js';
export const UsersStub=(mount)=>{ mount.replaceChildren(el('section',{className:'main-card'},[ el('h2',{},['Usuarios']), el('p',{},['Aquí irá el módulo real de usuarios (asignación de roles por Admin).']) ])); };
