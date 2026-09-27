import { el } from '../utils/dom.js';
import { assignmentVisitStatus, VISIT_STATUS, visitToday } from '../utils/visits.js';
import { googleMapsDirectionsUrl } from '../utils/sedeLocation.js';

export function SiteVisits(mount, deps, { contract = null, admin = false, actorId = null } = {}) {
  const ui = el('section', { className: 'site-visits' });
  let data = { cycles: [], assignments: [], visits: [], settings: null };
  let cycleId = '', supervisor = '', filter = 'all', disposed = false, busy = false, draft = null, sequence = 0;
  let previews = [];
  let hasLoaded = false;
  const notice = el('p', { role: 'status', className: 'site-visits__notice' });
  mount.replaceChildren(ui);
  const button = (label, action, primary = false) => el('button', { type: 'button', className: `btn${primary ? ' btn--primary' : ''}`, onclick: action }, [label]);
  function field(label, node) {
    node.id = `visit-field-${crypto.randomUUID()}`;
    return el('div', { className: 'site-visits__field' }, [el('label', { for: node.id }, [label]), node]);
  }
  function select(options, value, onchange) {
    return el('select', { className: 'select', onchange }, options.map(([key, label]) => el('option', { value: key, selected: key === value }, [label])));
  }
  function clearPreviews() { previews.forEach(url => URL.revokeObjectURL(url)); previews = []; }
  function canLeave() { return !busy && (!draft || window.confirm('Hay una visita sin enviar. ¿Quieres salir y descartar el formulario?')); }
  function unload(event) { if (draft || busy) { event.preventDefault(); event.returnValue = ''; } }
  window.addEventListener('beforeunload', unload);
  async function load({ sync = true, savedMessage = '' } = {}) {
    const request = ++sequence;
    notice.textContent = 'Cargando visitas…';
    if (!ui.childNodes.length) ui.append(notice);
    try {
      const loaded = await deps.loadVisits(contract, { sync });
      if (disposed || request !== sequence) return;
      data = loaded;
      hasLoaded = true;
      data.cycles.sort((a, b) => b.starts_on.localeCompare(a.starts_on) || a.contract_name.localeCompare(b.contract_name));
      if (!data.cycles.some(cycle => cycle.id === cycleId)) cycleId = data.cycles[0]?.id || '';
      render();
      notice.textContent = savedMessage;
    } catch (error) {
      if (disposed || request !== sequence) return;
      const message = savedMessage
        ? `${savedMessage} No se pudo actualizar la vista: ${error.message} No necesitas volver a guardar.`
        : `No se pudieron cargar las visitas: ${error.message}`;
      if (hasLoaded) {
        render();
        notice.replaceChildren(el('span', {}, [message]), button('Reintentar', () => load({ sync, savedMessage })));
      } else {
        ui.replaceChildren(el('h2', {}, ['Visitas']), el('p', { role: 'alert' }, [message]), button('Reintentar', () => load({ sync, savedMessage })));
      }
    }
  }
  function settingsPanel() {
    const current = data.settings;
    const locked = data.cycles.length > 0;
    const today = visitToday();
    const frequency = select([['weekly', 'Semanal · 7 días'], ['fortnightly', 'Quincenal · 14 días'], ['monthly', 'Mensual · mes calendario']], current?.frequency || 'weekly');
    const start = el('input', { className: 'input', type: 'date', required: true, value: current?.starts_on || today });
    const radius = el('input', { className: 'input', type: 'number', min: 20, max: 2000, required: true, value: current?.radius_m || 200 });
    const accuracy = el('input', { className: 'input', type: 'number', min: 5, max: 500, required: true, value: current?.accuracy_m || 100 });
    frequency.disabled = start.disabled = locked;
    frequency.onchange = () => { if (frequency.value === 'monthly') start.value = start.value.slice(0, 8) + '01'; };
    const message = el('p', { role: 'status' });
    const save = el('button', { className: 'btn btn--primary', type: 'submit' }, ['Guardar programación']);
    const form = el('form', { className: 'site-visits__box' }, [
      el('h3', {}, ['Programación de visitas']),
      el('p', {}, ['Las sedes se asignan automáticamente por las zonas de cada supervisor dentro de este contrato.']),
      el('div', { className: 'site-visits__fields' }, [field('Frecuencia', frequency), field('Inicio (mensual: día 1)', start), field('Radio GPS permitido (metros)', radius), field('Precisión GPS máxima (metros)', accuracy)]),
      el('p', { className: 'text-muted' }, [locked ? 'El calendario iniciado conserva su frecuencia y fecha. Los cambios de criterios GPS se aplican a los próximos ciclos.' : 'El ciclo mensual abarca del 1 al último día del mes. Si activas el mes en curso, estará disponible desde hoy.']),
      message, save
    ]);
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      if (frequency.value === 'monthly' && !start.value.endsWith('-01')) { message.textContent = 'Los ciclos mensuales deben comenzar el día 1.'; return; }
      busy = true; save.disabled = true; message.textContent = 'Guardando…';
      try {
        const settings = { frequency: frequency.value, starts_on: start.value, radius_m: Number(radius.value), accuracy_m: Number(accuracy.value) };
        await deps.saveVisitSettings(contract, settings);
        if (!disposed) {
          data.settings = { ...data.settings, ...settings };
          await load({ sync: false, savedMessage: 'Programación guardada correctamente.' });
        }
      } catch (error) { message.textContent = error.message; }
      finally { busy = false; save.disabled = false; }
    };
    return form;
  }
  function render() {
    if (disposed) return;
    const cycle = data.cycles.find(row => row.id === cycleId);
    const all = data.assignments.filter(row => row.cycle_id === cycleId);
    const scoped = all.filter(row => !supervisor || (row.supervisor_id || 'unassigned') === supervisor);
    const state = row => assignmentVisitStatus(row, data.visits, cycle);
    const count = key => scoped.filter(row => state(row) === key).length;
    const completed = count('completed');
    notice.textContent = '';
    const children = [el('h2', {}, [admin ? 'Visitas' : 'Tus ciclos de visitas'])];
    if (admin) children.push(el('details', { className: 'site-visits__settings', open: !data.settings }, [
      el('summary', {}, ['Programación de visitas']), settingsPanel()
    ]));
    if (!cycle) {
      const upcoming = admin && data.settings?.starts_on > visitToday();
      children.push(el('p', {}, [admin
        ? upcoming ? `La programación comienza el ${data.settings.starts_on}. El primer ciclo y sus sedes se mostrarán a partir de esa fecha.` : 'No hay ciclos iniciados para este contrato.'
        : 'No tienes ciclos de visitas asignados. Las sedes aparecerán cuando inicie la programación del contrato.']));
      ui.replaceChildren(...children, notice, button('Actualizar', load)); return;
    }
    const supervisorOptions = [...new Map(all.map(row => [row.supervisor_id || 'unassigned', row.supervisor_name])).entries()];
    const controls = [field('Contrato y ciclo', select(data.cycles.map(row => [row.id, `${row.contract_name} · ${row.starts_on} al ${row.ends_on}`]), cycleId, event => { cycleId = event.target.value; supervisor = ''; render(); })),
      field('Estado de la sede', select([['all', 'Todas'], ['pending', 'Pendientes'], ['review', 'En revisión'], ['completed', 'Cumplidas'], ['overdue', 'Incumplidas']], filter, event => { filter = event.target.value; render(); }))];
    if (admin) controls.push(field('Supervisor', select([['', 'Todos los supervisores'], ...supervisorOptions], supervisor, event => { supervisor = event.target.value; render(); })));
    if (admin) {
      controls.push(button('Actualizar', load));
      children.splice(1, 0, el('div', { className: 'site-visits__toolbar' }, controls));
    } else {
      children.push(el('div', { className: 'site-visits__fields' }, controls));
    }
    children.push(
      el('div', { className: 'site-visits__box' }, [el('strong', {}, [`${completed} de ${scoped.length} ${admin ? 'asignaciones' : 'sedes'} cumplidas`]),
        el('progress', { max: scoped.length || 1, value: completed, 'aria-label': 'Cumplimiento del ciclo' }),
        el('p', {}, [`${count('pending')} pendientes · ${count('review')} en revisión · ${count('overdue')} incumplidas`]),
        el('p', { className: 'text-muted' }, [`Una visita válida por sede. Ciclo: ${cycle.starts_on} al ${cycle.ends_on}.`])]), notice);
    if (!admin) children.push(button('Actualizar', load));
    const order = { overdue: 0, pending: 1, review: 2, completed: 3 };
    const assignments = scoped.filter(row => filter === 'all' || state(row) === filter).sort((a, b) => order[state(a)] - order[state(b)] || a.sede_name.localeCompare(b.sede_name));
    children.push(...assignments.map(row => {
      const records = data.visits.filter(visit => visit.assignment_id === row.id && visit.submitted_at);
      const lastVisit = records.map(visit => visit.submitted_at).sort().at(-1);
      const actions = [button(`Historial (${records.length})`, () => showHistory(row))];
      if (!admin && (!actorId || row.supervisor_id === actorId) && cycle.starts_on <= visitToday() && cycle.ends_on >= visitToday()) actions.unshift(button('Registrar visita', () => startVisit(row), true));
      return el('article', { className: 'site-visits__box' }, [el('h3', {}, [row.sede_name]),
        el('p', { className: 'text-muted' }, [`${row.sede_codigo} · Zona ${row.zone_code || 'sin asignar'}${admin ? ' · ' + row.supervisor_name : ''}`]),
        el('strong', { className: `site-visits__state site-visits__state--${state(row)}` }, [VISIT_STATUS[state(row)]]),
        el('p', { className: 'text-muted' }, [lastVisit ? `Última visita del ciclo: ${new Date(lastVisit).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}` : 'Sin visitas enviadas en este ciclo.']),
        el('div', { className: 'site-visits__actions' }, actions)]);
    }));
    if (!assignments.length) children.push(el('p', {}, ['No hay sedes con estos filtros.']));
    ui.replaceChildren(...children);
  }
  async function startVisit(assignment) {
    if (busy) return;
    busy = true; notice.textContent = 'Capturando tu ubicación GPS…';
    ui.querySelectorAll('button').forEach(node => { node.disabled = true; });
    try {
      if (!navigator.geolocation) throw new Error('Tu navegador no permite capturar GPS.');
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }));
      if (disposed) return;
      const gps = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      const id = crypto.randomUUID();
      await deps.beginVisit(id, assignment.id, gps);
      if (disposed) return;
      draft = { id, assignment, gps, photos: new Map() };
      showForm();
    } catch (error) { notice.textContent = `No se pudo iniciar la visita: ${error.message || 'Activa la ubicación y autoriza el acceso al GPS.'}`; }
    finally { busy = false; ui.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
  }
  function showForm() {
    const currentDraft = draft;
    const photos = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', capture: 'environment', multiple: true, required: true });
    const thumbnails = el('div', { className: 'site-visits__photos' });
    photos.onchange = () => {
      clearPreviews();
      thumbnails.replaceChildren(...Array.from(photos.files).map(file => {
        const url = URL.createObjectURL(file); previews.push(url);
        return el('img', { src: url, alt: 'Foto seleccionada de la visita' });
      }));
    };
    const finding = select([['', 'Selecciona una opción'], ['no', 'Sin novedades'], ['yes', 'Con novedades']], ''); finding.required = true;
    const textArea = () => el('textarea', { className: 'input', rows: 3, maxLength: 5000 });
    const description = textArea(), recommendations = textArea(), observations = textArea();
    finding.onchange = () => { description.required = finding.value === 'yes'; description.disabled = finding.value !== 'yes'; };
    description.disabled = true;
    const message = el('p', { role: 'status' });
    const save = el('button', { type: 'submit', className: 'btn btn--primary' }, ['Enviar visita']);
    const cancel = button('Cancelar', () => { if (canLeave()) { draft = null; clearPreviews(); render(); } });
    const form = el('form', { className: 'site-visits__box' }, [el('h2', {}, [`Visita · ${draft.assignment.sede_name}`]),
      el('p', {}, [`GPS capturado · precisión ${Math.round(draft.gps.accuracy)} m. Envía la visita en los próximos 30 minutos.`]),
      field('Fotos de la visita (1 a 6, máximo 8 MB cada una)', photos), thumbnails,
      field('¿Encontraste novedades?', finding), field('Descripción de las novedades', description), field('Recomendaciones', recommendations), field('Observaciones', observations),
      message, el('div', { className: 'site-visits__actions' }, [save, cancel])]);
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      const files = Array.from(photos.files);
      if (!files.length || files.length > 6 || files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8388608 || !file.size)) {
        message.textContent = 'Adjunta entre 1 y 6 fotos JPG, PNG o WebP de hasta 8 MB cada una.'; return;
      }
      busy = true; form.querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = true; });
      try {
        const paths = [];
        for (const [index, file] of files.entries()) {
          message.textContent = `Subiendo foto ${index + 1} de ${files.length}…`;
          if (!currentDraft.photos.has(file)) currentDraft.photos.set(file, await deps.uploadVisitPhoto(currentDraft.id, file));
          paths.push(currentDraft.photos.get(file));
        }
        const status = await deps.submitVisit(currentDraft.id, { has_findings: finding.value === 'yes', findings: description.value, recommendations: recommendations.value, observations: observations.value, photos: paths });
        draft = null; clearPreviews();
        if (!disposed) await load({ sync: false, savedMessage: status === 'valid' ? 'Visita registrada y validada.' : 'Visita enviada. La evidencia GPS requiere revisión administrativa.' });
      } catch (error) { message.textContent = `No se pudo enviar: ${error.message}. Tus datos se conservan para reintentar.`; }
      finally {
        busy = false; form.querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = false; });
        description.disabled = finding.value !== 'yes';
      }
    };
    ui.replaceChildren(form);
  }
  function showHistory(assignment) {
    const historyVersion = ++sequence;
    const records = data.visits.filter(row => row.assignment_id === assignment.id && row.submitted_at).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
    ui.replaceChildren(button('Volver al ciclo', render), el('h2', {}, [`Visitas · ${assignment.sede_name}`]));
    if (!records.length) ui.append(el('p', {}, ['Esta sede aún no tiene visitas enviadas en el ciclo.']));
    records.forEach(visit => {
      const photos = el('div', { className: 'site-visits__photos' });
      const card = el('article', { className: 'site-visits__box' }, [
        el('h3', {}, [VISIT_STATUS[visit.status]]), el('p', {}, [new Date(visit.submitted_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })]),
        el('p', {}, [`Precisión GPS: ${Math.round(visit.accuracy_m)} m · Distancia a sede: ${visit.distance_m == null ? 'No disponible' : Math.round(visit.distance_m) + ' m'}`]),
        el('a', { className: 'btn', href: googleMapsDirectionsUrl(visit.latitude, visit.longitude), target: '_blank', rel: 'noopener noreferrer' }, ['Ver ubicación de la visita']),
        el('iframe', { className: 'site-visits__map', title: 'Ubicación registrada en la visita', loading: 'lazy',
          src: `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent([visit.longitude - 0.005, visit.latitude - 0.005, visit.longitude + 0.005, visit.latitude + 0.005].join(','))}&layer=mapnik&marker=${encodeURIComponent(`${visit.latitude},${visit.longitude}`)}` }),
        el('p', {}, [visit.gps_issue || 'Ubicación dentro de los criterios del ciclo.']),
        el('p', {}, [`Novedades: ${visit.has_findings ? visit.findings : 'Sin novedades'}`]),
        el('p', {}, [`Recomendaciones: ${visit.recommendations || 'Sin recomendaciones'}`]),
        el('p', {}, [`Observaciones: ${visit.observations || 'Sin observaciones'}`]), photos,
        ...(visit.review_note ? [el('p', {}, [`Revisión: ${visit.review_note}`])] : [])
      ]);
      for (const path of visit.photos) {
        const photo = el('span', {}, ['Cargando foto…']); photos.append(photo);
        deps.getVisitPhotoUrl(path).then(url => {
          if (disposed || historyVersion !== sequence) return;
          photo.replaceWith(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, [el('img', { src: url, alt: 'Evidencia de la visita', loading: 'lazy' })]));
        }).catch(() => { photo.textContent = 'No se pudo cargar la foto. Vuelve a abrir el historial para reintentar.'; });
      }
      if (admin && visit.status === 'review') {
        const note = el('textarea', { className: 'input', rows: 2, maxLength: 5000 });
        const message = el('p', { role: 'status' });
        const decide = async accept => {
          if (busy) return;
          if (!note.value.trim()) { message.textContent = 'Registra el motivo de la decisión.'; return; }
          busy = true;
          try { await deps.reviewVisit(visit.id, accept, note.value); if (!disposed) await load({ sync: false, savedMessage: 'Revisión guardada correctamente.' }); }
          catch (error) { message.textContent = error.message; } finally { busy = false; }
        };
        card.append(field('Motivo de la revisión', note), message, el('div', { className: 'site-visits__actions' }, [button('Aprobar visita', () => decide(true)), button('Rechazar visita', () => decide(false))]));
      }
      ui.append(card);
    });
  }
  load();
  const cleanup = () => { disposed = true; sequence++; clearPreviews(); window.removeEventListener('beforeunload', unload); };
  cleanup.canLeave = canLeave;
  return cleanup;
}
