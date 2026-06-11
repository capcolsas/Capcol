import { el, qs } from '../utils/dom.js';

const DEVICE_TOKEN_KEY = 'rocky_qr_device_token';

export const QrTabletScanner = (mount, deps = {}) => {
  let stream = null;
  let detector = null;
  let scanning = false;
  let lastValue = '';
  let lastScanAt = 0;

  const savedToken = getDeviceToken();
  const ui = el('section', { className: 'main-card' }, [
    el('div', { className: 'wa-header__top' }, [
      el('h2', {}, ['Lector QR']),
      el('span', { id: 'deviceStatus', className: `badge ${savedToken ? 'badge--ok' : 'badge--off'}` }, [savedToken ? 'Tablet activa' : 'Sin activar'])
    ]),
    el('div', { className: 'form-row mt-2' }, [
      el('div', {}, [
        el('label', { className: 'label' }, ['Token de dispositivo']),
        el('input', { id: 'deviceToken', className: 'input', type: 'password', value: savedToken, placeholder: 'Token generado desde Sedes' })
      ]),
      el('button', { id: 'btnSaveDevice', className: 'btn btn--primary', type: 'button' }, ['Activar tablet']),
      el('button', { id: 'btnClearDevice', className: 'btn', type: 'button' }, ['Limpiar'])
    ]),
    el('div', { className: 'mt-2', style: 'display:grid;gap:12px;' }, [
      el('video', { id: 'qrVideo', autoplay: true, muted: true, playsInline: true, style: 'width:100%;max-height:56vh;background:#111;border-radius:8px;object-fit:cover;' }),
      el('div', { className: 'row-actions' }, [
        el('button', { id: 'btnStartCamera', className: 'btn btn--primary', type: 'button' }, ['Iniciar camara']),
        el('button', { id: 'btnStopCamera', className: 'btn', type: 'button' }, ['Detener'])
      ])
    ]),
    el('div', { className: 'form-row mt-2' }, [
      el('div', {}, [
        el('label', { className: 'label' }, ['Lectura manual']),
        el('input', { id: 'manualQr', className: 'input', placeholder: 'Pega aqui el contenido del QR si la camara no detecta' })
      ]),
      el('button', { id: 'btnManualScan', className: 'btn', type: 'button' }, ['Validar'])
    ]),
    el('p', { id: 'qrMessage', className: 'text-muted mt-2' }, ['Activa la tablet y luego inicia la camara.'])
  ]);

  function getDeviceToken() {
    try {
      return String(localStorage.getItem(DEVICE_TOKEN_KEY) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function setMessage(text, kind = 'muted') {
    const msg = qs('#qrMessage', ui);
    if (!msg) return;
    msg.className = `mt-2 ${kind === 'error' ? 'text-danger' : kind === 'ok' ? 'text-success' : 'text-muted'}`;
    msg.textContent = text;
  }

  function syncDeviceStatus() {
    const token = getDeviceToken();
    const status = qs('#deviceStatus', ui);
    if (!status) return;
    status.className = `badge ${token ? 'badge--ok' : 'badge--off'}`;
    status.textContent = token ? 'Tablet activa' : 'Sin activar';
  }

  function saveDeviceToken() {
    const token = qs('#deviceToken', ui)?.value?.trim() || '';
    if (!token) {
      setMessage('Pega el token de dispositivo generado desde Sedes.', 'error');
      return;
    }
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
    syncDeviceStatus();
    setMessage('Tablet activada en este navegador.', 'ok');
  }

  function clearDeviceToken() {
    localStorage.removeItem(DEVICE_TOKEN_KEY);
    const input = qs('#deviceToken', ui);
    if (input) input.value = '';
    syncDeviceStatus();
    setMessage('Token de tablet eliminado.', 'muted');
  }

  async function startCamera() {
    const token = getDeviceToken();
    if (!token) {
      setMessage('Activa primero la tablet con su token de dispositivo.', 'error');
      return;
    }
    if (!('BarcodeDetector' in window)) {
      setMessage('Este navegador no soporta lectura QR por camara. Usa la lectura manual.', 'error');
      return;
    }
    detector = detector || new window.BarcodeDetector({ formats: ['qr_code'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const video = qs('#qrVideo', ui);
    video.srcObject = stream;
    await video.play();
    scanning = true;
    setMessage('Camara activa. Acerca el QR al recuadro.', 'muted');
    scanLoop();
  }

  function stopCamera() {
    scanning = false;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    const video = qs('#qrVideo', ui);
    if (video) video.srcObject = null;
    setMessage('Camara detenida.', 'muted');
  }

  async function scanLoop() {
    if (!scanning) return;
    const video = qs('#qrVideo', ui);
    try {
      if (video?.readyState >= 2 && detector) {
        const codes = await detector.detect(video);
        const value = String(codes?.[0]?.rawValue || '').trim();
        if (value) await processQrValue(value);
      }
    } catch (error) {
      console.error('Error leyendo QR:', error);
    }
    if (scanning) window.requestAnimationFrame(scanLoop);
  }

  async function processQrValue(value) {
    const now = Date.now();
    if (value === lastValue && now - lastScanAt < 5000) return;
    lastValue = value;
    lastScanAt = now;
    const deviceToken = getDeviceToken();
    if (!deviceToken) {
      setMessage('La tablet no esta activada.', 'error');
      return;
    }
    try {
      setMessage('Validando QR...', 'muted');
      const result = await deps.scanAttendanceQr?.({ qrValue: value, deviceToken });
      const action = result?.action === 'exit' ? 'Salida' : 'Ingreso';
      const name = result?.employee?.nombre || result?.employee?.documento || 'Empleado';
      setMessage(`${action} registrado: ${name}.`, 'ok');
    } catch (error) {
      setMessage(error?.message || 'No se pudo validar el QR.', 'error');
    }
  }

  qs('#btnSaveDevice', ui)?.addEventListener('click', saveDeviceToken);
  qs('#btnClearDevice', ui)?.addEventListener('click', clearDeviceToken);
  qs('#btnStartCamera', ui)?.addEventListener('click', () => startCamera().catch((error) => setMessage(error?.message || 'No se pudo iniciar la camara.', 'error')));
  qs('#btnStopCamera', ui)?.addEventListener('click', stopCamera);
  qs('#btnManualScan', ui)?.addEventListener('click', () => {
    const value = qs('#manualQr', ui)?.value?.trim() || '';
    if (!value) {
      setMessage('Pega el contenido del QR para validar.', 'error');
      return;
    }
    processQrValue(value);
  });

  mount.replaceChildren(ui);
  return () => stopCamera();
};
