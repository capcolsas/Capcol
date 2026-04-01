import { el } from '../utils/dom.js';
export const CargarDatos=(mount)=>{
  mount.replaceChildren(el('section',{className:'main-card'},[
    el('h2',{},['Cargar datos']),
    el('p',{},['(Modulo en proxima iteracion)'])
  ]));
};
