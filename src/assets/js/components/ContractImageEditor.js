import { el, lucideInlineIcon } from '../utils/dom.js';

export function showContractImageEditor(contract, deps) {
  const previousFocus = document.activeElement;
  let file = null;
  let changed = false;
  let saving = false;
  let closed = false;
  let localUrl = null;
  const initial = (contract.nombre || contract.codigo || 'CT').slice(0, 2).toUpperCase();
  const preview = el('div', { className: 'contract-image-editor__preview' }, [initial]);
  const message = el('p', { className: 'text-muted', role: 'status', 'aria-live': 'polite' }, []);
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', className: 'hidden', 'aria-label': 'Imagen de referencia' });
  const choose = el('button', { type: 'button', className: 'btn', title: 'Seleccionar imagen' }, [lucideInlineIcon('upload', '+'), 'Seleccionar imagen']);
  const remove = el('button', { type: 'button', className: 'btn btn--icon', title: 'Quitar imagen', 'aria-label': 'Quitar imagen', disabled: !contract.referenceImagePath }, [lucideInlineIcon('trash-2', 'X')]);
  const cancel = el('button', { type: 'button', className: 'btn' }, ['Cancelar']);
  const save = el('button', { type: 'button', className: 'btn btn--primary', disabled: true }, ['Guardar imagen']);
  const overlay = el('div', { className: 'action-modal__overlay contract-image-editor' }, [
    el('div', { className: 'action-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'contract-image-title' }, [
      el('div', { className: 'action-modal__header' }, [el('h3', { id: 'contract-image-title', className: 'action-modal__title' }, ['Imagen de referencia'])]),
      el('div', { className: 'action-modal__body' }, [
        el('p', {}, [contract.nombre || contract.codigo]), preview, input,
        el('p', { className: 'text-muted' }, ['PNG, JPG o WebP. Maximo 2 MB.']),
        el('div', { className: 'form-row' }, [choose, remove]), message
      ]),
      el('div', { className: 'action-modal__footer' }, [cancel, save])
    ])
  ]);
  function releasePreview() {
    if (localUrl) URL.revokeObjectURL(localUrl);
    localUrl = null;
  }
  function showPreview(url) {
    const img = el('img', { src: url, alt: 'Imagen del contrato' });
    img.addEventListener('error', () => {
      preview.replaceChildren(initial);
      message.textContent = 'No se pudo mostrar la imagen.';
    });
    preview.replaceChildren(img);
  }
  function close() {
    closed = true;
    releasePreview();
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function onKey(event) {
    if (event.key === 'Escape' && !saving) close();
    if (event.key !== 'Tab') return;
    const buttons = [...overlay.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const selected = input.files?.[0];
    if (!selected) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || !selected.size || selected.size > 2 * 1024 * 1024) {
      message.textContent = 'Selecciona una imagen PNG, JPG o WebP de hasta 2 MB.';
      input.value = '';
      return;
    }
    releasePreview();
    file = selected;
    changed = true;
    localUrl = URL.createObjectURL(file);
    showPreview(localUrl);
    remove.disabled = false;
    save.disabled = false;
    message.textContent = '';
  });
  remove.addEventListener('click', () => {
    releasePreview();
    input.value = '';
    file = null;
    changed = true;
    preview.replaceChildren(initial);
    remove.disabled = true;
    save.disabled = false;
    message.textContent = 'Se quitara la imagen al guardar.';
  });
  cancel.addEventListener('click', () => { if (!saving) close(); });
  save.addEventListener('click', async () => {
    if (!changed || saving) return;
    saving = true;
    [choose, remove, cancel, save].forEach(button => { button.disabled = true; });
    message.textContent = 'Guardando imagen...';
    try {
      await deps.saveContractReferenceImage(contract.id, file);
      close();
    } catch (error) {
      if (!closed) {
        message.textContent = `No se pudo guardar: ${error?.message || error}`;
        choose.disabled = cancel.disabled = save.disabled = false;
        remove.disabled = !file && !contract.referenceImagePath;
      }
    } finally { saving = false; }
  });
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  choose.focus();
  if (contract.referenceImagePath) {
    deps.getContractReferenceImageUrl(contract.referenceImagePath).then(url => {
      if (!closed && !changed && url) showPreview(url);
    }).catch(() => {
      if (!closed && !changed) message.textContent = 'No se pudo cargar la imagen actual. Puedes reemplazarla o quitarla.';
    });
  }
  return close;
}
