import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { config } from '../config.js';
import { certificateTemplateConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_PATH = path.join(__dirname, 'template.html');

const CERTIFICATE_TYPES = new Set(['basic', 'with_salary']);

export function normalizeCertificateType(value) {
  const type = String(value || 'basic').trim().toLowerCase();
  return CERTIFICATE_TYPES.has(type) ? type : 'basic';
}

export function certificateFileName(employee = {}, type = 'basic') {
  const doc = safeFilePart(employee?.documento || 'empleado');
  const suffix = type === 'with_salary' ? 'con-salario' : 'basico';
  return `certificado-laboral-${suffix}-${doc}.pdf`;
}

export async function buildEmployeeCertificatePdf({ employee, cargo, type }) {
  const normalizedType = normalizeCertificateType(type);
  const html = await buildCertificateHtml({ employee, cargo, type: normalizedType });
  return renderPdfFromHtml(html);
}

export async function buildCertificateHtml({ employee, cargo, type }) {
  if (!employee?.id) throw new Error('employee_not_found');
  if (String(employee?.estado || '').trim().toLowerCase() !== 'activo') throw new Error('employee_inactive');

  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const cfg = certificateTemplateConfig;
  const salary = cargo?.salario == null ? null : Number(cargo.salario);
  if (type === 'with_salary' && (!Number.isFinite(salary) || salary < 0)) {
    throw new Error('missing_salary');
  }

  const values = {
    headerJustify: cssJustify(cfg.header?.align),
    headerLogoMaxWidth: cfg.header?.maxWidth || '190px',
    headerLogoMaxHeight: cfg.header?.maxHeight || '70px',
    footerImageMaxWidth: cfg.footer?.maxWidth || '100%',
    footerImageMaxHeight: cfg.footer?.maxHeight || '100%',
    signatureMaxWidth: cfg.signature?.maxWidth || '180px',
    signatureMaxHeight: cfg.signature?.maxHeight || '90px',
    headerLogoTag: await imageTag(cfg.header?.imagePath || cfg.header?.logoPath, cfg.companyLegalName),
    footerImageTag: await imageTag(cfg.footer?.imagePath, ''),
    footerTextBlock: footerTextBlockHtml(cfg),
    signatureImageTag: await imageTag(cfg.signature?.imagePath, 'Firma autorizada'),
    companyLegalName: cfg.companyLegalName || '',
    companyNit: cfg.companyNit || '',
    companyRegimeText: cfg.companyRegimeText || '',
    footerLines: footerLinesHtml(cfg.footer?.lines || []),
    city: cfg.city || '',
    issueDate: formatLongDate(new Date(), cfg),
    employeeName: employee.nombre || 'Empleado',
    employeeDocument: employee.documento || '-',
    employeeStartDate: formatLongDate(employee.fecha_ingreso, cfg),
    employeeCargo: employee.cargo_nombre || cargo?.nombre || employee.cargo_codigo || '-',
    salaryBlock: type === 'with_salary' ? salaryBlockHtml(salary, cfg) : '',
    signerName: cfg.signature?.signerName || '',
    signerTitle: cfg.signature?.signerTitle || ''
  };

  return renderTemplate(template, values);
}

async function renderPdfFromHtml(html) {
  let browser = null;
  try {
    const executablePath = await resolveChromeExecutablePath();
    const isLocalExecutable = process.platform === 'win32' || Boolean(config.certificateChromeExecutablePath);
    browser = await puppeteer.launch({
      args: isLocalExecutable ? puppeteer.defaultArgs({ headless: 'new' }) : chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: isLocalExecutable ? 'new' : chromium.headless
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true
    });
  } catch (error) {
    console.error('Certificate PDF engine failed:', {
      platform: process.platform,
      isVercel: Boolean(process.env.VERCEL),
      configuredExecutable: Boolean(config.certificateChromeExecutablePath),
      message: error?.message || null,
      name: error?.name || null,
      stack: error?.stack || null
    });
    const wrapped = new Error('certificate_pdf_engine_unavailable', { cause: error });
    wrapped.statusCode = 500;
    throw wrapped;
  } finally {
    if (browser) await browser.close();
  }
}

async function resolveChromeExecutablePath() {
  const configured = String(config.certificateChromeExecutablePath || '').trim();
  if (configured) return configured;

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {}
    }
  }

  return chromium.executablePath();
}

function renderTemplate(template, values) {
  return String(template || '').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : ''
  ));
}

async function imageTag(assetPath, altText) {
  const dataUri = await assetDataUri(assetPath);
  if (!dataUri) return '';
  return `<img src="${dataUri}" alt="${escapeHtml(altText || '')}">`;
}

async function assetDataUri(assetPath) {
  const raw = String(assetPath || '').trim();
  if (!raw) return '';
  try {
    const resolved = path.isAbsolute(raw) ? raw : path.resolve(__dirname, raw);
    const bytes = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.svg'
          ? 'image/svg+xml'
          : 'image/png';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  }
}

function footerLinesHtml(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => escapeHtml(line))
    .filter(Boolean)
    .join('<br>');
}

function footerTextBlockHtml(cfg) {
  const lines = footerLinesHtml(cfg.footer?.lines || []);
  if (!lines) return '';
  return [
    `<strong>${escapeHtml(cfg.companyLegalName || '')}</strong><br>`,
    `[ NIT: ${escapeHtml(cfg.companyNit || '')} ] ${escapeHtml(cfg.companyRegimeText || '')}<br>`,
    lines
  ].join('');
}

function salaryBlockHtml(salary, cfg) {
  return `<p>Actualmente devenga un salario de <strong>${escapeHtml(formatCurrency(salary, cfg))}</strong>.</p>`;
}

function formatCurrency(value, cfg) {
  return new Intl.NumberFormat(cfg.locale || 'es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatLongDate(value, cfg) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(cfg.locale || 'es-CO', {
    timeZone: cfg.timezone || 'America/Bogota',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

function cssJustify(value) {
  const align = String(value || '').trim().toLowerCase();
  if (align === 'center') return 'center';
  if (align === 'right') return 'flex-end';
  return 'flex-start';
}

function safeFilePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim() || 'archivo';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
