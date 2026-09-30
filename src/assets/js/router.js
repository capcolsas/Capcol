const routes = new Map();
let renderCurrentRoute = () => {};
let currentCleanup = null;
let renderToken = 0;

export const addRoute = (path, renderFn) => routes.set(path, renderFn);
export const navigate = (path) => {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
};

const getPath = () => (window.location.hash || '#/login').replace('#', '').split('?')[0];

export const refreshRoute = () => {
  renderCurrentRoute();
};

export const startRouter = () => {
  const render = async () => {
    const token = ++renderToken;
    if (typeof currentCleanup === 'function') {
      try { currentCleanup(); } catch {}
      currentCleanup = null;
    }
    const path = getPath();
    const view = routes.get(path) || routes.get('/login');
    const maybeCleanup = await view?.();
    if (token !== renderToken) {
      // A newer navigation happened while this view's module/data was loading; discard it.
      if (typeof maybeCleanup === 'function') { try { maybeCleanup(); } catch {} }
      return;
    }
    if (typeof maybeCleanup === 'function') currentCleanup = maybeCleanup;
  };
  renderCurrentRoute = render;
  window.addEventListener('hashchange', render);
  render();
};
