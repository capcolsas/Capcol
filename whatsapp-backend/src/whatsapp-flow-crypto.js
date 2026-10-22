import crypto from 'node:crypto';

// WhatsApp Flows endpoint encryption: Meta sends an AES-128 key encrypted with our RSA public key
// (RSA-OAEP / SHA-256); request and response bodies are AES-128-GCM, the response with the IV flipped.
const GCM_TAG_LENGTH = 16;

export function flowCryptoError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function decryptFlowRequest(body, privateKeyPem, passphrase = '') {
  const { encrypted_aes_key: encryptedAesKey, encrypted_flow_data: encryptedFlowData, initial_vector: initialVector } = body || {};
  if (!encryptedAesKey || !encryptedFlowData || !initialVector) throw flowCryptoError('invalid_flow_request', 400);

  let aesKey;
  try {
    aesKey = crypto.privateDecrypt({
      key: crypto.createPrivateKey({ key: privateKeyPem, passphrase: passphrase || undefined }),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    }, Buffer.from(encryptedAesKey, 'base64'));
  } catch {
    // 421 tells the WhatsApp client to refresh our public key and retry.
    throw flowCryptoError('flow_key_mismatch', 421);
  }

  const flowData = Buffer.from(encryptedFlowData, 'base64');
  const iv = Buffer.from(initialVector, 'base64');
  try {
    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
    decipher.setAuthTag(flowData.subarray(-GCM_TAG_LENGTH));
    const json = Buffer.concat([decipher.update(flowData.subarray(0, -GCM_TAG_LENGTH)), decipher.final()]).toString('utf8');
    return { body: JSON.parse(json), aesKey, iv };
  } catch {
    throw flowCryptoError('flow_key_mismatch', 421);
  }
}

export function encryptFlowResponse(response, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map(byte => ~byte & 0xff));
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
  return Buffer.concat([cipher.update(JSON.stringify(response), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
}

// Files from PhotoPicker/DocumentPicker sit encrypted on the WhatsApp CDN: AES-256-CBC with a
// 10-byte HMAC-SHA256 suffix. Every hash is checked so a tampered or truncated file is rejected.
const MEDIA_HMAC_LENGTH = 10;

export function decryptFlowMedia(encryptedFile, metadata = {}) {
  const file = Buffer.from(encryptedFile);
  const sha256 = value => crypto.createHash('sha256').update(value).digest();
  const expectedEncryptedHash = Buffer.from(String(metadata.encrypted_hash || ''), 'base64');
  if (!expectedEncryptedHash.length || !sha256(file).equals(expectedEncryptedHash)) throw flowCryptoError('flow_media_hash_mismatch', 422);
  if (file.length <= MEDIA_HMAC_LENGTH) throw flowCryptoError('flow_media_invalid', 422);

  const ciphertext = file.subarray(0, -MEDIA_HMAC_LENGTH);
  const iv = Buffer.from(String(metadata.iv || ''), 'base64');
  const hmac = crypto.createHmac('sha256', Buffer.from(String(metadata.hmac_key || ''), 'base64'))
    .update(Buffer.concat([iv, ciphertext])).digest().subarray(0, MEDIA_HMAC_LENGTH);
  if (!crypto.timingSafeEqual(hmac, file.subarray(-MEDIA_HMAC_LENGTH))) throw flowCryptoError('flow_media_hmac_mismatch', 422);

  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(String(metadata.encryption_key || ''), 'base64'), iv);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw flowCryptoError('flow_media_invalid', 422);
  }
  if (!sha256(plaintext).equals(Buffer.from(String(metadata.plaintext_hash || ''), 'base64'))) throw flowCryptoError('flow_media_hash_mismatch', 422);
  return plaintext;
}
