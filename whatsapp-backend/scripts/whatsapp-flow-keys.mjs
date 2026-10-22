// Llaves de cifrado para el endpoint de WhatsApp Flows.
//
//   node scripts/whatsapp-flow-keys.mjs generate <carpeta> <frase>
//     Crea flow-private.pem (cifrada con la frase) y flow-public.pem en <carpeta>, fuera del repositorio.
//     La privada va a WHATSAPP_FLOW_PRIVATE_KEY y la frase a WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE.
//
//   node scripts/whatsapp-flow-keys.mjs upload <ruta flow-public.pem>
//     Registra la llave publica en el numero (WHATSAPP_PHONE_NUMBER_ID) con WHATSAPP_ACCESS_TOKEN.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(backendRoot, '.env') });

const [command, target, passphrase] = process.argv.slice(2);

if (command === 'generate') {
  if (!target || !passphrase) throw new Error('Uso: generate <carpeta> <frase>');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
  });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'flow-private.pem'), privateKey, { mode: 0o600 });
  await fs.writeFile(path.join(target, 'flow-public.pem'), publicKey);
  console.log(`Llaves creadas en ${path.resolve(target)}. Para Vercel, la privada en una linea:`);
  console.log(JSON.stringify(privateKey).slice(1, -1));
} else if (command === 'upload') {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const version = String(process.env.WHATSAPP_GRAPH_VERSION || 'v25.0').trim();
  if (!target || !token || !phoneNumberId) throw new Error('Uso: upload <flow-public.pem> con WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID en .env');
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/whatsapp_business_encryption`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ business_public_key: await fs.readFile(target, 'utf8') })
  });
  console.log(response.status, await response.text());
  if (!response.ok) process.exitCode = 1;
} else {
  console.log('Comandos: generate <carpeta> <frase> | upload <flow-public.pem>');
}
