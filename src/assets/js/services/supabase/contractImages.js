import { supabase } from './client.js';
import { updateContractReferenceImage, addAuditLog } from './legacy.js';

const BUCKET = 'contract-reference-images';
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 2 * 1024 * 1024;

export async function getContractReferenceImageUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function saveContractReferenceImage(contractId, file) {
  if (!contractId) throw new Error('Falta el contrato.');
  const { data: contract, error: readError } = await supabase.from('contracts')
    .select('reference_image_path').eq('id', contractId).single();
  if (readError) throw readError;
  let nextPath = null;
  if (file) {
    if (!TYPES.has(file.type) || file.size > MAX_BYTES || !file.size) {
      throw new Error('Selecciona una imagen PNG, JPG o WebP de hasta 2 MB.');
    }
    const blob = await thumbnail(file);
    nextPath = `${contractId}/${crypto.randomUUID()}.webp`;
    const { error } = await supabase.storage.from(BUCKET).upload(nextPath, blob, {
      contentType: 'image/webp', cacheControl: '3600', upsert: false
    });
    if (error) throw error;
  }
  try {
    await updateContractReferenceImage(contractId, nextPath);
  } catch (error) {
    // A failed database update must not leave the newly uploaded image behind.
    if (nextPath) await removeUnusedImage(nextPath);
    throw error;
  }
  const previousPath = contract.reference_image_path;
  if (previousPath?.startsWith(`${contractId}/`)) await removeUnusedImage(previousPath);
  try {
    await addAuditLog({ targetType: 'contract', targetId: contractId, action: 'update_contract_image',
      before: { referenceImagePath: previousPath }, after: { referenceImagePath: nextPath } });
  } catch (error) { console.warn('No se pudo registrar la auditoria de la imagen del contrato.', error); }
  return nextPath;
}

async function removeUnusedImage(path) {
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) console.warn('No se pudo eliminar una imagen de contrato sin uso.', error);
  } catch (error) { console.warn('No se pudo eliminar una imagen de contrato sin uso.', error); }
}

async function thumbnail(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('El archivo no contiene una imagen valida.'); }
  try {
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob || blob.type !== 'image/webp') throw new Error('No se pudo preparar la imagen.');
    return blob;
  } finally { bitmap.close(); }
}
