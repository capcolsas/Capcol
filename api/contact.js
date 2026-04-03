const tls = require('node:tls');
const crypto = require('node:crypto');

const DEFAULT_TO_EMAIL = 'capcol@capcol.com.co';
const DEFAULT_SUBJECT = 'Solicitud de propuesta comercial';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Metodo no permitido.' });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const proposal = sanitizePayload(payload);
    const validationError = validatePayload(proposal);

    if (validationError) {
      sendJson(res, 400, { ok: false, error: validationError });
      return;
    }

    const smtpConfig = readSmtpConfig();
    await sendProposalBySmtp(smtpConfig, proposal);

    sendJson(res, 200, {
      ok: true,
      mode: 'email',
      message: 'Solicitud enviada correctamente. Te contactaremos pronto.'
    });
  } catch (error) {
    console.error('Error procesando /api/contact:', error);
    sendJson(res, mapStatusCode(error), {
      ok: false,
      error: mapErrorMessage(error)
    });
  }
};

function readEnv(name, fallback = '') {
  return String(process.env[name] || fallback || '').trim();
}

function readSmtpConfig() {
  const host = readEnv('SMTP_HOST');
  const port = Number(readEnv('SMTP_PORT', '465'));
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  const secure = !/^false$/i.test(readEnv('SMTP_SECURE', 'true'));
  const fromEmail = readEnv('CONTACT_FROM_EMAIL', user);
  const toEmail = readEnv('CONTACT_TO_EMAIL', DEFAULT_TO_EMAIL);

  if (!host || !user || !pass || !fromEmail || !toEmail || !Number.isFinite(port)) {
    const error = new Error('missing_smtp_config');
    error.statusCode = 500;
    throw error;
  }

  return { host, port, user, pass, secure, fromEmail, toEmail };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('invalid_json');
    error.statusCode = 400;
    throw error;
  }
}

function sanitizePayload(payload = {}) {
  return {
    name: String(payload.name || '').trim(),
    email: String(payload.email || '').trim(),
    subject: String(payload.subject || DEFAULT_SUBJECT).trim(),
    message: String(payload.message || '').trim()
  };
}

function validatePayload(payload) {
  if (!payload.name) return 'Ingresa tu nombre completo.';
  if (!payload.email) return 'Ingresa tu correo empresarial.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return 'Ingresa un correo valido.';
  if (!payload.subject) return 'Ingresa el asunto de la solicitud.';
  if (!payload.message) return 'Ingresa el mensaje de la solicitud.';
  if (payload.name.length > 120) return 'El nombre es demasiado largo.';
  if (payload.subject.length > 180) return 'El asunto es demasiado largo.';
  if (payload.message.length > 5000) return 'El mensaje es demasiado largo.';
  return null;
}

async function sendProposalBySmtp(config, proposal) {
  const client = await openSmtpConnection(config);

  try {
    await client.expect(220);
    await client.command(`EHLO ${smtpEhloName(config.fromEmail)}`, 250);
    await client.command('AUTH LOGIN', 334);
    await client.command(Buffer.from(config.user, 'utf8').toString('base64'), 334);
    await client.command(Buffer.from(config.pass, 'utf8').toString('base64'), 235);
    await client.command(`MAIL FROM:<${extractEmail(config.fromEmail)}>`, 250);
    await client.command(`RCPT TO:<${extractEmail(config.toEmail)}>`, [250, 251]);
    await client.command('DATA', 354);
    await client.sendData(buildMimeMessage(config, proposal), 250);
    await client.command('QUIT', 221);
  } finally {
    client.close();
  }
}

function openSmtpConnection(config) {
  return new Promise((resolve, reject) => {
    if (!config.secure) {
      reject(Object.assign(new Error('unsupported_insecure_smtp'), { statusCode: 500 }));
      return;
    }

    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
      rejectUnauthorized: true
    });

    const session = createSmtpSession(socket);
    let settled = false;

    const onError = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
      session.rejectAll(error);
    };

    socket.once('secureConnect', () => {
      if (settled) return;
      settled = true;
      socket.off('error', onError);
      resolve(session);
    });

    socket.once('error', onError);
    socket.setTimeout(30000, () => {
      const error = Object.assign(new Error('smtp_timeout'), { statusCode: 504 });
      socket.destroy(error);
    });
  });
}

function createSmtpSession(socket) {
  let buffer = '';
  let currentLines = [];
  const waiters = [];

  socket.setEncoding('utf8');

  socket.on('data', (chunk) => {
    buffer += chunk;

    while (true) {
      const lineBreak = buffer.indexOf('\r\n');
      if (lineBreak === -1) break;

      const line = buffer.slice(0, lineBreak);
      buffer = buffer.slice(lineBreak + 2);
      currentLines.push(line);

      const match = line.match(/^(\d{3})([ -])/);
      if (!match || match[2] === '-') continue;

      const response = {
        code: Number(match[1]),
        text: currentLines.join('\n')
      };
      currentLines = [];

      const waiter = waiters.shift();
      if (waiter) waiter.resolve(response);
    }
  });

  socket.on('error', (error) => {
    rejectAll(error);
  });

  socket.on('close', () => {
    rejectAll(Object.assign(new Error('smtp_connection_closed'), { statusCode: 502 }));
  });

  function rejectAll(error) {
    while (waiters.length) {
      const waiter = waiters.shift();
      waiter.reject(error);
    }
  }

  function readResponse() {
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }

  async function expect(expectedCodes) {
    const response = await readResponse();
    assertResponse(response, expectedCodes);
    return response;
  }

  async function command(line, expectedCodes) {
    socket.write(`${line}\r\n`);
    return expect(expectedCodes);
  }

  async function sendData(message, expectedCodes) {
    socket.write(`${message}\r\n.\r\n`);
    return expect(expectedCodes);
  }

  function close() {
    if (!socket.destroyed) socket.end();
  }

  return { expect, command, sendData, close, rejectAll };
}

function assertResponse(response, expectedCodes) {
  const allowed = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
  if (allowed.includes(response.code)) return;

  const error = new Error(`smtp_unexpected_response_${response.code}`);
  error.statusCode = 502;
  error.smtpResponse = response.text;
  throw error;
}

function buildMimeMessage(config, proposal) {
  const fromEmail = extractEmail(config.fromEmail);
  const messageId = `<${crypto.randomUUID()}@${sanitizeMessageIdHost(fromEmail)}>`;
  const headers = [
    `From: ${formatAddressHeader(config.fromEmail)}`,
    `To: ${formatAddressHeader(config.toEmail)}`,
    `Reply-To: ${sanitizeHeader(proposal.email)}`,
    `Subject: ${encodeMimeHeader(sanitizeHeader(proposal.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit'
  ];

  const body = buildEmailText(proposal)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');

  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

function buildEmailText(payload) {
  return [
    'Nueva solicitud de propuesta comercial',
    '',
    `Nombre: ${payload.name}`,
    `Correo: ${payload.email}`,
    `Asunto: ${payload.subject}`,
    '',
    'Mensaje:',
    payload.message
  ].join('\n');
}

function extractEmail(value) {
  const text = String(value || '').trim();
  const match = text.match(/<([^>]+)>/);
  return sanitizeHeader(match ? match[1] : text);
}

function formatAddressHeader(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(.*)<([^>]+)>$/);
  if (!match) return sanitizeHeader(text);

  const displayName = sanitizeHeader(match[1].trim().replace(/^"|"$/g, ''));
  const email = sanitizeHeader(match[2].trim());
  if (!displayName) return email;
  return `${encodeMimeHeader(displayName)} <${email}>`;
}

function encodeMimeHeader(value) {
  const text = sanitizeHeader(value);
  if (!/[^\x20-\x7E]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeMessageIdHost(email) {
  const domain = String(String(email || '').split('@')[1] || 'localhost').toLowerCase();
  return domain.replace(/[^a-z0-9.-]+/g, '') || 'localhost';
}

function smtpEhloName(fromEmail) {
  return sanitizeMessageIdHost(extractEmail(fromEmail));
}

function mapStatusCode(error) {
  return Number(error?.statusCode) || 500;
}

function mapErrorMessage(error) {
  const code = String(error?.message || '').trim();

  if (code === 'invalid_json') return 'La solicitud del formulario no es valida.';
  if (code === 'missing_smtp_config') return 'Falta configurar el servicio SMTP en Vercel.';
  if (code === 'smtp_timeout') return 'El servidor de correo no respondio a tiempo.';
  if (code === 'unsupported_insecure_smtp') return 'La configuracion SMTP debe usar SSL seguro.';
  if (code.startsWith('smtp_unexpected_response_')) return 'El servidor SMTP rechazo el envio del correo.';

  return 'No fue posible enviar la solicitud en este momento.';
}
