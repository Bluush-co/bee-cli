import type { Environment } from "@/environment";

const TOKEN_SERVICE = "bee-cli";

function tokenKey(env: Environment): { service: string; name: string } {
  return { service: TOKEN_SERVICE, name: `token:${env}` };
}

function pairingStateKey(env: Environment): { service: string; name: string } {
  return { service: TOKEN_SERVICE, name: `pairing:${env}` };
}

export async function loadToken(env: Environment): Promise<string | null> {
  const value = await Bun.secrets.get(tokenKey(env));
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function saveToken(env: Environment, token: string): Promise<void> {
  await Bun.secrets.set({ ...tokenKey(env), value: token });
}

export async function clearToken(env: Environment): Promise<void> {
  await Bun.secrets.delete(tokenKey(env));
}

export type PairingState = {
  appId: string;
  publicKey: string;
  secretKey: string;
  requestId: string;
  pairingUrl: string;
  expiresAt: string;
};

export async function loadPairingState(
  env: Environment
): Promise<PairingState | null> {
  const value = await Bun.secrets.get(pairingStateKey(env));
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(value) as PairingState;
  } catch {
    return null;
  }
}

export async function savePairingState(
  env: Environment,
  state: PairingState
): Promise<void> {
  await Bun.secrets.set({ ...pairingStateKey(env), value: JSON.stringify(state) });
}

export async function clearPairingState(env: Environment): Promise<void> {
  await Bun.secrets.delete(pairingStateKey(env));
}
