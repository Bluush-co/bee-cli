import { select } from "@inquirer/prompts";
import type { Command, CommandContext } from "@/commands/types";
import { getEnvironmentConfig } from "@/environment";
import { clearToken, loadToken, saveToken } from "@/secureStore";
import { openBrowser } from "@/utils/browser";
import { renderQrCode } from "@/utils/qrCode";

type LoginOptions = {
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

type DeviceAuthStart = {
  device_code: string;
  user_code: string;
  verification_url: string;
  verification_uri_complete: string | null;
  expires_in: number;
  interval: number;
};

type DeviceAuthPollOutcome =
  | { status: "success"; token: string }
  | { status: "pending"; retryInMs?: number };

type DeviceAuthMethod = "browser" | "qr";

const USAGE = [
  "bee [--staging] auth login [--skip-verify]",
  "bee [--staging] auth login --token <token> [--skip-verify]",
  "bee [--staging] auth login --token-stdin [--skip-verify]",
  "bee [--staging] auth status [--no-verify]",
  "bee [--staging] auth logout",
].join("\n");

const DESCRIPTION =
  "Manage developer API authentication (app tokens with embedded secrets).";

export const authCommand: Command = {
  name: "auth",
  description: DESCRIPTION,
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use login, status, or logout.");
    }

    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "login":
        await handleLogin(rest, context);
        return;
      case "status":
        await handleStatus(rest, context);
        return;
      case "logout":
        await handleLogout(rest, context);
        return;
      default:
        throw new Error(`Unknown auth subcommand: ${subcommand}`);
    }
  },
};

async function handleLogin(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
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
    token = await loginWithDeviceFlow(context);
  }

  if (!token) {
    throw new Error("Missing token.");
  }

  token = token.trim();

  let user: DevUser | null = null;
  if (!options.skipVerify) {
    user = await fetchDeveloperMe(context, token);
  }

  await saveToken(context.env, token);

  if (user) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    console.log(`Authenticated as ${name} (id ${user.id}).`);
    return;
  }

  console.log("Token stored.");
}

async function handleStatus(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseStatusArgs(args);
  const token = await loadToken(context.env);
  const config = getEnvironmentConfig(context.env);

  if (!token) {
    console.log("Not logged in.");
    console.log(`API: ${config.label} (${config.apiUrl})`);
    return;
  }

  console.log(`API: ${config.label} (${config.apiUrl})`);
  console.log(`Token: ${maskToken(token)}`);

  if (options.noVerify) {
    return;
  }

  const user = await fetchDeveloperMe(context, token);
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  console.log(`Verified as ${name} (id ${user.id}).`);
}

async function handleLogout(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  if (args.length > 0) {
    throw new Error("logout does not accept arguments.");
  }
  await clearToken(context.env);
  console.log("Logged out.");
}

function parseLoginArgs(args: readonly string[]): LoginOptions {
  let token: string | undefined;
  let tokenStdin = false;
  let skipVerify = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
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

async function loginWithDeviceFlow(context: CommandContext): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Interactive login requires a TTY. Use --token or --token-stdin."
    );
  }

  const deviceAuth = await startDeviceAuth(context);
  const verificationUrl = resolveVerificationUrl(deviceAuth);
  const method = await selectAuthMethod();

  await presentDeviceAuth(method, verificationUrl, deviceAuth.user_code);
  console.log("Waiting for authorization...");

  return await pollForDeviceToken(context, deviceAuth);
}

function resolveVerificationUrl(deviceAuth: DeviceAuthStart): string {
  if (deviceAuth.verification_uri_complete) {
    return deviceAuth.verification_uri_complete;
  }

  try {
    const url = new URL(deviceAuth.verification_url);
    if (!url.searchParams.has("code")) {
      url.searchParams.set("code", deviceAuth.user_code);
    }
    return url.toString();
  } catch {
    return deviceAuth.verification_url;
  }
}

async function selectAuthMethod(): Promise<DeviceAuthMethod> {
  return await select({
    message: "How would you like to authenticate?",
    choices: [
      { name: "Open a browser window", value: "browser" },
      { name: "Show a QR code", value: "qr" },
    ],
  });
}

async function presentDeviceAuth(
  method: DeviceAuthMethod,
  verificationUrl: string,
  userCode: string
): Promise<void> {
  console.log(`Open this URL to continue: ${verificationUrl}`);
  console.log(`Use code: ${userCode}`);

  if (method === "browser") {
    const opened = await openBrowser(verificationUrl);
    if (!opened) {
      console.log("Unable to open the browser automatically.");
    }
    return;
  }

  const qrCode = await renderQrCode(verificationUrl);
  console.log(qrCode);
}

async function startDeviceAuth(
  context: CommandContext
): Promise<DeviceAuthStart> {
  const response = await context.client.fetch("/v1/auth/device/start", {
    method: "POST",
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
  const deviceCode = data?.["device_code"];
  const userCode = data?.["user_code"];
  const verificationUrl =
    typeof data?.["verification_url"] === "string"
      ? data["verification_url"]
      : data?.["verification_uri"];
  const verificationUriComplete = data?.["verification_uri_complete"];
  const expiresIn = data?.["expires_in"];
  const interval = data?.["interval"];

  if (
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUrl !== "string" ||
    typeof expiresIn !== "number"
  ) {
    throw new Error("Invalid response from developer API.");
  }

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_url: verificationUrl,
    verification_uri_complete:
      typeof verificationUriComplete === "string"
        ? verificationUriComplete
        : null,
    expires_in: expiresIn,
    interval: typeof interval === "number" && interval > 0 ? interval : 5,
  };
}

async function pollForDeviceToken(
  context: CommandContext,
  deviceAuth: DeviceAuthStart
): Promise<string> {
  const expiresAt = Date.now() + deviceAuth.expires_in * 1000;
  let intervalMs = deviceAuth.interval * 1000;

  while (Date.now() < expiresAt) {
    const outcome = await fetchDeviceToken(context, deviceAuth.device_code);
    if (outcome.status === "success") {
      return outcome.token;
    }

    if (typeof outcome.retryInMs === "number" && outcome.retryInMs > 0) {
      intervalMs = outcome.retryInMs;
    }

    await sleep(intervalMs);
  }

  throw new Error("Login timed out. Please try again.");
}

async function fetchDeviceToken(
  context: CommandContext,
  deviceCode: string
): Promise<DeviceAuthPollOutcome> {
  const response = await context.client.fetch("/v1/auth/device/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ device_code: deviceCode }),
  });

  if (response.ok) {
    const data = await safeJson(response);
    const token =
      typeof data?.["token"] === "string"
        ? data["token"]
        : typeof data?.["access_token"] === "string"
          ? data["access_token"]
          : null;
    if (!token) {
      throw new Error("Invalid response from developer API.");
    }
    return { status: "success", token };
  }

  if (response.status === 202) {
    return { status: "pending" };
  }

  const errorPayload = await safeJson(response);
  const errorCode =
    typeof errorPayload?.["error"] === "string" ? errorPayload["error"] : null;

  if (errorCode === "authorization_pending") {
    return { status: "pending" };
  }

  if (errorCode === "slow_down") {
    const retryIn = errorPayload?.["interval"];
    const retryInMs =
      typeof retryIn === "number" && retryIn > 0 ? retryIn * 1000 : undefined;
    if (retryInMs !== undefined) {
      return { status: "pending", retryInMs };
    }
    return { status: "pending" };
  }

  if (errorCode === "expired_token") {
    throw new Error("Login expired. Please run the command again.");
  }

  if (errorCode === "access_denied") {
    throw new Error("Login was canceled.");
  }

  const errorMessage =
    typeof errorPayload?.["error_description"] === "string"
      ? errorPayload["error_description"]
      : typeof errorPayload?.["error"] === "string"
        ? errorPayload["error"]
        : `Request failed with status ${response.status}`;
  throw new Error(errorMessage);
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function fetchDeveloperMe(
  context: CommandContext,
  token: string
): Promise<DevUser> {
  const response = await context.client.fetch("/v1/me", {
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
  if (typeof id !== "number" || typeof firstName !== "string") {
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
