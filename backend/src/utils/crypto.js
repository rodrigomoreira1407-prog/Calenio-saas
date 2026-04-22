const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || "", "hex");

// Criptografa texto (prontuários) — LGPD
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Formato: IV:TAG:CIPHERTEXT (tudo em base64)
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

// Descriptografa
function decrypt(data) {
  if (!data) return null;
  try {
    const [ivB64, tagB64, cipherB64] = data.split(":");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(cipherB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch (err) {
    console.error("Erro ao descriptografar:", err.message);
    return null;
  }
}

module.exports = { encrypt, decrypt };