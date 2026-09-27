import { el, lucideInlineIcon } from '../utils/dom.js';
import { getState } from '../state.js';
import { isMobileSidebarOpen, toggleMobileSidebar } from './Sidebar.js';

export const Header=(deps={})=>{
  const { user }=getState();
  if (!user) return el('div', { className: 'header--empty' }, []);
  const mobileMenuBtn = user ? el('button',{
    className:'btn header-btn header-mobile-toggle',
    type:'button',
    title:'Abrir menu',
    'aria-label':'Abrir menu lateral',
    'aria-controls':'app-sidebar'
  },['☰']) : null;
  const syncMobileMenuBtn = () => {
    if (!mobileMenuBtn) return;
    const open = isMobileSidebarOpen();
    mobileMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    mobileMenuBtn.replaceChildren(lucideInlineIcon(open ? 'x' : 'menu', open ? 'X' : '='));
    mobileMenuBtn.title = open ? 'Cerrar menu' : 'Abrir menu';
    mobileMenuBtn.setAttribute('aria-label', mobileMenuBtn.title);
  };
  syncMobileMenuBtn();
  mobileMenuBtn?.addEventListener('click', () => {
    toggleMobileSidebar();
    syncMobileMenuBtn();
  });
  const nav=el('nav',{className:'header-nav container'},[
    mobileMenuBtn
  ]);
  return el('div',{className:user ? 'header header--minimal' : 'header'},[nav]);
};
