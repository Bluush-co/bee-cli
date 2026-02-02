import type { Command } from "@/commands/types";
import { clearConfig, loadConfig, saveConfig } from "@/config";

type LoginOptions = {
  apiUrl?: string;
  token?: string;
  tokenStdin: boolean;
  skipVerify: boolean;
};

type StatusOptions = {
  noVerify: boolean;
};

type DevUser = {
  id: number;
  first_name: string;
  last_name: string | null;
};

const USAGE = [
  "bee auth login --token <token> [--api-url <url>] [--skip-verify]",
  "bee auth login --token-stdin [--api-url <url>] [--skip-verify]",
  "bee auth status [--no-verify]",
  "bee auth logout",
].join("\n");

const DESCRIPTION =
  "Manage developer API authentication (app tokens with embedded secrets).";

export const authCommand: Command = {
  name: "auth",
  description: DESCRIPTION,
  usage: USAGE,
  run: async (args) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use login, status, or logout.");
    }

    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "login":
        await handleLogin(rest);
        return;
      case "status":
        await handleStatus(rest);
        return;
      case "logout":
        await handleLogout(rest);
        return;
      default:
        throw new Error(`Unknown auth subcommand: ${subcommand}`);
    }
  },
};

async function handleLogin(args: readonly string[]): Promise<void> {
  const options = parseLoginArgs(args);

  if (options.tokenStdin && options.token) {
    throw new Error("Use either --token or --token-stdin, not both.");
  }

  let token = options.token;
  if (options.tokenStdin) {
    token = await readTokenFromStdin();
  }

  if (token) {
    token = token.trim();
  }

  if (!token) {
    throw new Error("Missing token. Provide --token or --token-stdin.");
  }

  const current = await loadConfig();
  const apiUrl =
    options.apiUrl ??
    current.apiUrl ??
    process.env["BEE_API_URL"]?.trim() ??
    undefined;

  let user: DevUser | null = null;
  if (!options.skipVerify && apiUrl) {
    user = await fetchDeveloperMe(apiUrl, token);
  }

  const nextConfig = { ...current };
  if (apiUrl) {
    nextConfig.apiUrl = apiUrl;
  }
  nextConfig.token = token;
  await saveConfig(nextConfig);

  if (user) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    console.log(`Authenticated as ${name} (id ${user.id}).`);
    return;
  }

  if (!apiUrl) {
    console.log("Token stored. Set an API URL to verify it later.");
    return;
  }

  console.log("Token stored.");
}

async function handleStatus(args: readonly string[]): Promise<void> {
  const options = parseStatusArgs(args);
  const config = await loadConfig();
  const apiUrl = config.apiUrl ?? process.env["BEE_API_URL"]?.trim();

  if (!config.token) {
    console.log("Not logged in.");
    if (apiUrl) {
      console.log(`API URL: ${apiUrl}`);
    } else {
      console.log("API URL: not set");
    }
    return;
  }

  console.log(`API URL: ${apiUrl ?? "not set"}`);
  console.log(`Token: ${maskToken(config.token)}`);

  if (options.noVerify || !apiUrl) {
    return;
  }

  const user = await fetchDeveloperMe(apiUrl, config.token);
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  console.log(`Verified as ${name} (id ${user.id}).`);
}

async function handleLogout(args: readonly string[]): Promise<void> {
  if (args.length > 0) {
    throw new Error("logout does not accept arguments.");
  }
  await clearConfig();
  console.log("Logged out.");
}

function parseLoginArgs(args: readonly string[]): LoginOptions {
  let apiUrl: string | undefined;
  let token: string | undefined;
  let tokenStdin = false;
  let skipVerify = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--api-url") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--api-url requires a value");
      }
      apiUrl = value.trim();
      if (apiUrl.length === 0) {
        throw new Error("--api-url must not be empty");
      }
      i += 1;
      continue;
    }

    if (arg === "--token") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--token requires a value");
      }
      token = value;
      i += 1;
      continue;
    }

    if (arg === "--token-stdin") {
      tokenStdin = true;
      continue;
    }

    if (arg === "--skip-verify") {
      skipVerify = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 0) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  const options: LoginOptions = { tokenStdin, skipVerify };
  if (apiUrl !== undefined) {
    options.apiUrl = apiUrl;
  }
  if (token !== undefined) {
    options.token = token;
  }
  return options;
}

function parseStatusArgs(args: readonly string[]): StatusOptions {
  let noVerify = false;
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === "--no-verify") {
      noVerify = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 0) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  return { noVerify };
}

async function readTokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("--token-stdin requires input via stdin.");
  }

  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");

  return await new Promise<string>((resolve, reject) => {
    process.stdin.on("data", (chunk) => {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      } else {
        chunks.push(chunk.toString("utf8"));
      }
    });
    process.stdin.on("error", (error) => {
      reject(error);
    });
    process.stdin.on("end", () => {
      resolve(chunks.join("").trim());
    });
  });
}

function maskToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 8) {
    return "********";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

async function fetchDeveloperMe(apiUrl: string, token: string): Promise<DevUser> {
  const url = new URL("/v1/me", apiUrl);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorPayload = await safeJson(response);
    const message =
      typeof errorPayload?.["error"] === "string"
        ? errorPayload["error"]
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  const data = await safeJson(response);
  const id = data?.["id"];
  const firstName = data?.["first_name"];
  if (
    typeof id !== "number" ||
    typeof firstName !== "string"
  ) {
    throw new Error("Invalid response from developer API.");
  }

  return {
    id,
    first_name: firstName,
    last_name: typeof data?.["last_name"] === "string" ? data["last_name"] : null,
  };
}

async function safeJson(
  response: Response
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await response.json()) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
