// Session/scope-local sharing. Nothing is persisted to localStorage.
export function shareContractStream(start, scope) {
  const groups = new Map();
  return (onData, onError = null, onStatus = null) => {
    const key = scope();
    let group = groups.get(key);
    const listener = { onData, onError, onStatus };
    if (!group) {
      group = { listeners: new Set(), replay: [], stop: null, fallback: false };
      groups.set(key, group);
    }
    group.listeners.add(listener);
    const deliver = (target, method, args) => target[method]?.(...args);
    if (group.listeners.size === 1) {
      group.stop = start((rows) => {
        const event = ['onData', [rows]];
        if (group.fallback && !rows?.length) group.replay.push(event);
        else group.replay = [event];
        group.fallback = false;
        for (const target of [...group.listeners]) deliver(target, ...event);
      }, (...args) => {
        if (args[1] === 'LOAD_ERROR') {
          group.replay = [['onError', args]];
          group.fallback = true;
        }
        for (const target of [...group.listeners]) deliver(target, 'onError', args);
      }, (...args) => {
        for (const target of [...group.listeners]) deliver(target, 'onStatus', args);
      });
    } else {
      for (const event of group.replay) deliver(listener, ...event);
    }
    return () => {
      group.listeners.delete(listener);
      if (!group.listeners.size && groups.get(key) === group) {
        groups.delete(key);
        group.stop?.();
      }
    };
  };
}

export function shareContractImageUrls(load, scope, ttl = 55 * 60 * 1000) {
  let currentScope;
  const entries = new Map();
  return path => {
    if (!path) return Promise.resolve(null);
    const key = scope();
    if (key !== currentScope) { entries.clear(); currentScope = key; }
    const cached = entries.get(path);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const entry = { expires: Date.now() + ttl, promise: null };
    entry.promise = Promise.resolve().then(() => load(path)).then(url => {
      if (!url && entries.get(path) === entry) entries.delete(path);
      return url;
    }).catch(error => {
      if (entries.get(path) === entry) entries.delete(path);
      throw error;
    });
    entries.set(path, entry);
    return entry.promise;
  };
}
