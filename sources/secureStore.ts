import type { Environment } from "@/environment";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_SERVICE = "bee-cli";

// File-based fallback directory
const CONFIG_DIR = join(homedir(), ".bee");
const getTokenFilePath = (env: Environment) => join(CONFIG_DIR, `token-${env}`);
const getPairingFilePath = (env: Environment) => join(CONFIG_DIR, `pairing-${env}.json`);

// Switches to file fallback when libsecret is unavailable
let useFileFallback = false;

function tokenKey(env: Environment): { service: string; name: string } {
  return { service: TOKEN_SERVICE, name: `token:${env}` };
}

function pairingStateKey(env: Environment): { service: string; name: string } {
  return { service: TOKEN_SERVICE, name: `pairing:${env}` };
}

function handleKeychainError(err: unknown): void {
  const message = String(err).toLowerCase();
  const isKeychainUnavailable =
    message.includes("libsecret") ||
    message.includes("keychain") ||
    message.includes("secret service") ||
    message.includes("dbus");

  if (isKeychainUnavailable) {
    if (!useFileFallback) {
      useFileFallback = true;
      console.error("Keychain not available, using file-based token storage (~/.bee/)");
    }
  } else {
    throw err;
  }
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true });
  }
}

function loadTokenFromFile(env: Environment): string | null {
  const path = getTokenFilePath(env);
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, "utf-8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveTokenToFile(env: Environment, token: string): void {
  ensureConfigDir();
  writeFileSync(getTokenFilePath(env), token, { mode: 0o600 });
}

function clearTokenFromFile(env: Environment): void {
  const path = getTokenFilePath(env);
  if (existsSync(path)) unlinkSync(path);
}

export async function loadToken(env: Environment): Promise<string | null> {
  if (!useFileFallback) {
    try {
      const value = await Bun.secrets.get(tokenKey(env));
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    } catch (err) {
      handleKeychainError(err);
    }
  }
  return loadTokenFromFile(env);
}

export async function saveToken(env: Environment, token: string): Promise<void> {
  if (!useFileFallback) {
    try {
      await Bun.secrets.set({ ...tokenKey(env), value: token });
      return;
    } catch (err) {
      handleKeychainError(err);
    }
  }
  saveTokenToFile(env, token);
}

export async function clearToken(env: Environment): Promise<void> {
  if (!useFileFallback) {
    try {
      await Bun.secrets.delete(tokenKey(env));
    } catch (err) {
      handleKeychainError(err);
    }
  }
  // Always clear file-based storage to remove any orphaned credentials
  clearTokenFromFile(env);
}

export type PairingState = {
  appId: string;
  publicKey: string;
  secretKey: string;
  requestId: string;
  pairingUrl: string;
  expiresAt: string;
};

function loadPairingStateFromFile(env: Environment): PairingState | null {
  const path = getPairingFilePath(env);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PairingState;
  } catch {
    return null;
  }
}

function savePairingStateToFile(env: Environment, state: PairingState): void {
  ensureConfigDir();
  writeFileSync(getPairingFilePath(env), JSON.stringify(state), { mode: 0o600 });
}

function clearPairingStateFromFile(env: Environment): void {
  const path = getPairingFilePath(env);
  if (existsSync(path)) unlinkSync(path);
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function loadPairingState(env: Environment): Promise<PairingState | null> {
  if (!useFileFallback) {
    try {
      const value = await Bun.secrets.get(pairingStateKey(env));
      if (typeof value === "string" && value.trim().length > 0) {
        return parseJson<PairingState>(value);
      }
    } catch (err) {
      handleKeychainError(err);
    }
  }
  return loadPairingStateFromFile(env);
}

export async function savePairingState(env: Environment, state: PairingState): Promise<void> {
  if (!useFileFallback) {
    try {
      await Bun.secrets.set({ ...pairingStateKey(env), value: JSON.stringify(state) });
      return;
    } catch (err) {
      handleKeychainError(err);
    }
  }
  savePairingStateToFile(env, state);
}

export async function clearPairingState(env: Environment): Promise<void> {
  if (!useFileFallback) {
    try {
      await Bun.secrets.delete(pairingStateKey(env));
    } catch (err) {
      handleKeychainError(err);
    }
  }
  // Always clear file-based storage to remove any orphaned credentials
  clearPairingStateFromFile(env);
}
