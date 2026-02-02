import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type BeeConfig = {
  apiUrl?: string;
  token?: string;
};

const CONFIG_FILENAME = "config.json";

function resolveConfigDir(): string {
  const override = process.env["BEE_CONFIG_DIR"]?.trim();
  if (override) {
    return override;
  }

  const xdg = process.env["XDG_CONFIG_HOME"]?.trim();
  if (xdg) {
    return join(xdg, "bee");
  }

  return join(homedir(), ".config", "bee");
}

export function getConfigPath(): string {
  return join(resolveConfigDir(), CONFIG_FILENAME);
}

export async function loadConfig(): Promise<BeeConfig> {
  const path = getConfigPath();

  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<BeeConfig> | null;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const config: BeeConfig = {};
    if (typeof parsed.apiUrl === "string" && parsed.apiUrl.trim().length > 0) {
      config.apiUrl = parsed.apiUrl.trim();
    }
    if (typeof parsed.token === "string" && parsed.token.trim().length > 0) {
      config.token = parsed.token.trim();
    }
    return config;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveConfig(config: BeeConfig): Promise<void> {
  const path = getConfigPath();
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });

  const payload: BeeConfig = {};
  if (config.apiUrl && config.apiUrl.trim().length > 0) {
    payload.apiUrl = config.apiUrl.trim();
  }
  if (config.token && config.token.trim().length > 0) {
    payload.token = config.token.trim();
  }

  await fs.writeFile(path, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });

  try {
    await fs.chmod(path, 0o600);
  } catch {
    // Best-effort permissions; ignore on unsupported platforms.
  }
}

export async function clearConfig(): Promise<void> {
  const path = getConfigPath();
  try {
    await fs.unlink(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
