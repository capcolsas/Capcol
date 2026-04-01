
import { el } from '../utils/dom.js';
export const ImportsStub=(mount)=>{ mount.replaceChildren(el('section',{className:'main-card'},[ el('h2',{},['Importaciones']), el('p',{},['Aquí irá el flujo real de importación para EDITOR.']) ])); };
