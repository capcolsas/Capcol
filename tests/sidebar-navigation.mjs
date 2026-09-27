import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/assets/js/components/Sidebar.js', import.meta.url), 'utf8');
const setup = source.slice(0, source.indexOf('\nfunction buildSidebarContent('))
  .replace(/^import .*;\r?\n/gm, '').replace('export const Sidebar', 'globalThis.Sidebar');
const navStart = source.indexOf('function navLink(');
const navSource = source.slice(navStart, source.indexOf('\n}', navStart) + 2);
const state = { user: { uid: '1' }, userProfile: {}, selectedContractCode: 'A', sidebarContext: 'contract', theme: 'light' };
const listeners = new Map(), events = new Map();
const counts = { builds: 0, badges: 0, cleanup: 0, writes: 0, contractSubscriptions: 0 };
let route = '/turnos-planes', contractsCallback, contractsError, renderedStatus;
const nodes = [];
const el = (tag, props = {}, children = []) => {
  const classes = new Set((props.className || '').split(' '));
  const node = { tag, ...props, dataset: props.dataset || {}, children, handlers: {},
    classList: { add: value => classes.add(value), remove: value => classes.delete(value),
      toggle(value, active) { if (active) classes.add(value); else classes.delete(value); }, contains: value => classes.has(value) },
    replaceChildren(...items) { this.children = items; },
    setAttribute(key, value) { this[key] = value; }, getAttribute(key) { return this[key]; }, removeAttribute(key) { delete this[key]; },
    querySelectorAll() { return nodes.filter(n => n.tag === 'a'); },
    addEventListener(event, fn) { this.handlers[event] = fn; }
  };
  nodes.push(node); return node;
};
const bindBadge = () => { counts.badges++; return () => { counts.cleanup++; }; };
const setState = patch => {
  counts.writes++;
  Object.assign(state, patch);
  for (const key of Object.keys(patch)) for (const fn of listeners.get(key) || []) fn(state[key]);
};
const context = vm.createContext({
  el, getState: () => ({ ...state }), setState,
  subscribe(key, fn) { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); return () => listeners.get(key).delete(fn); },
  isSettingsMode: () => state.sidebarContext === 'settings', contractFilterCode: () => state.selectedContractCode,
  getCurrentRoute: () => route, navigate: to => { route = to; }, closeMobileSidebar() {},
  getNavIconMeta: () => ({}), lucideIcon: () => el('i'),
  buildSidebarContent: (_contracts, _deps, status) => { renderedStatus = status; counts.builds++; return [el('nav')]; },
  applySidebarKind() {}, scheduleLucideIcons() {}, bindSidebarBackdrop() {}, ensureMobileSidebarState() {},
  getSidebarCollapsedPref: () => false, applySidebarCollapsed() {},
  bindPendingNoveltyBadge: bindBadge, bindFreeSupernumerariosBadge: bindBadge, bindShiftReviewBadge: bindBadge,
  document: { documentElement: { setAttribute() {} }, querySelectorAll: () => nodes.filter(n => n.tag === 'a') },
  window: { addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) }
});
vm.runInContext(setup + '\n' + navSource, context);
const startupSidebar = context.Sidebar();
assert.equal(renderedStatus, 'loading', 'a restored session must show loading while app.js initializes the contract service');
assert.equal(counts.contractSubscriptions, 0, 'the startup placeholder has not attempted a query');
startupSidebar._cleanup();
const sidebar = context.Sidebar({ streamContracts(cb, onError) { counts.contractSubscriptions++; contractsCallback = cb; contractsError = onError; return () => {}; } });
assert.equal(renderedStatus, 'loading');
contractsError(new Error('Connection timeout'), 'TIMED_OUT');
assert.equal(renderedStatus, 'loading', 'realtime connection errors do not end the initial load');
for (let attempt = 0; attempt < 3; attempt++) {
  contractsError(new Error('Request failed'), 'LOAD_ERROR');
  contractsCallback([]);
  assert.equal(renderedStatus, 'loading', 'automatic retries must keep loading instead of showing an error or an empty catalog');
}
contractsCallback([{ codigo: 'A' }, { codigo: 'B' }]);
assert.equal(renderedStatus, 'ready', 'a successful retry completes loading');
const mountedContent = sidebar.children;
const baseline = { ...counts };
contractsError(new Error('Refresh failed'), 'LOAD_ERROR');
contractsCallback([]);
assert.equal(renderedStatus, 'ready', 'refresh failures preserve the loaded catalog');
assert.equal(sidebar.children, mountedContent, 'retry fallback must not replace the visible contracts');
const link = context.navLink('Turnos generados', '/turnos-generados', { contractCode: 'A', sidebarContext: 'contract' });
link.handlers.click({ preventDefault() {} });
events.get('hashchange')();
assert.equal(sidebar.children, mountedContent, 'module navigation preserves both sidebar DOM trees');
assert.equal(counts.builds, baseline.builds);
assert.equal(counts.badges, baseline.badges, 'module navigation cannot restart badge queries');
assert.equal(counts.writes, baseline.writes, 'module navigation cannot emit unchanged state');
assert.equal(link['aria-current'], 'page');
route = '/turnos-planes';
events.get('hashchange')();
assert.equal(link.classList.contains('is-active'), false, 'history navigation updates selection without rebuilding');
assert.equal(sidebar.children, mountedContent);
setState({ selectedContractCode: 'A', sidebarContext: 'contract' });
assert.equal(counts.builds, baseline.builds, 'duplicate notifications from other components are ignored');
contractsCallback([{ codigo: 'A' }, { codigo: 'B' }]);
assert.equal(counts.builds, baseline.builds, 'identical catalog snapshots do not rebuild images and badges');
context.updateSidebarState({ selectedContractCode: 'B', sidebarContext: 'settings' });
assert.equal(counts.builds, baseline.builds + 1, 'changing two context fields performs one rebuild');
assert.equal(counts.badges, baseline.badges + 3);
assert.equal(counts.contractSubscriptions, 1);
contractsCallback([{ codigo: 'A' }, { codigo: 'B', nombre: 'Updated' }]);
assert.equal(counts.builds, baseline.builds + 2, 'actual contract changes still update the sidebar');
sidebar._cleanup();
assert.equal(counts.cleanup, counts.badges, 'every badge binding is cleaned up');
assert.equal(events.size, 0);
assert([...listeners.values()].every(set => set.size === 0));
console.log('Sidebar navigation: stable DOM and subscriptions, unchanged state, history, context changes and cleanup passed.');
