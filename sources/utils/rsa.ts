import crypto from "node:crypto";

export type RsaKeyPair = {
  publicKeyPem: string;
  privateKeyPem: string;
};

export function generateRsaKeyPair(): RsaKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicExponent: 0x10001,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

export function decryptRsaOaepBase64(
  encryptedBase64: string,
  privateKeyPem: string
): string {
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(encryptedBase64, "base64")
  );

  return decrypted.toString("utf8");
}
