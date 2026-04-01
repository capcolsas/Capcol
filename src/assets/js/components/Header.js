import { el } from '../utils/dom.js';
import { getRole } from '../permissions.js';
import { navigate } from '../router.js';
import { getState, setState } from '../state.js';

export const Header=(deps={})=>{
  const { user, theme }=getState();
  const role=getRole();
  const themeBtn = el('button',{className:'btn header-btn header-theme-btn',type:'button'},[]);
  const syncThemeBtn = (currentTheme) => {
    const dark = currentTheme === 'dark';
    themeBtn.textContent = dark ? '☀' : '☾';
    themeBtn.title = dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    themeBtn.setAttribute('aria-label', themeBtn.title);
  };
  syncThemeBtn(theme);
  themeBtn.addEventListener('click', () => {
    const next = getState().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setState({ theme: next });
    syncThemeBtn(next);
  });

  const nav=el('nav',{className:'header-nav container'},[
    el('a',{href:'#',className:'header-nav__brand',title:'Servilimpieza','aria-label':'Servilimpieza'},[
      el('img',{className:'header-nav__brand-logo',src:'src/assets/img/servilimpieza-logo.svg',alt:'Logo Servilimpieza',loading:'lazy'})
    ]),
    navLink('Inicio','/',()=> navigate('/')),
    navLink('Contacto','/contact',()=> navigate('/contact')),
    navLink('Tratamiento Datos','/data-treatment',()=> navigate('/data-treatment')),
    navLink('Acerca','/about',()=> navigate('/about')),
    el('div',{className:'header-nav__spacer'},[]),
    themeBtn,
    user
      ? el('button',{className:'btn header-btn',onclick:async()=>{ await deps.logout?.(); navigate('/login'); }},['Cerrar sesion'])
      : el('button',{className:'btn btn--primary header-btn',onclick:()=> navigate('/login')},['Iniciar sesion']),
    el('span',{className:'role-badge',title:'Rol actual'},['Rol: ', role || '-'])
  ]);
  return el('div',{className:'header'},[nav]);
};

function navLink(text,to,onClick){
  const a=el('a',{href:`#${to}`,className:'header-nav__link'},[text]);
  a.addEventListener('click',(e)=>{ e.preventDefault(); onClick?.(); });
  return a;
}
