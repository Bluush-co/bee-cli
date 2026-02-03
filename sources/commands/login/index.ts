import { select } from "@inquirer/prompts";
import type { Command, CommandContext } from "@/commands/types";
import type { Environment } from "@/environment";
import {
  saveToken,
  loadPairingState,
  savePairingState,
  clearPairingState,
  type PairingState,
} from "@/secureStore";
import { requestAppPairing } from "@/commands/auth/appPairingRequest";
import {
  decryptAppPairingToken,
  generateAppPairingKeyPair,
} from "@/utils/appPairingCrypto";
import { emojiHash } from "@/utils/emojiHash";
import { openBrowser } from "@/utils/browser";
import { renderQrCode } from "@/utils/qrCode";
import { fetchClientMe } from "@/client/clientMe";

type LoginOptions = {
  token?: string;
  tokenStdin: boolean;
  agent: boolean;
};

type DeviceAuthMethod = "browser" | "qr";

const USAGE = [
  "bee login",
  "bee login --agent",
  "bee login --token <token>",
  "bee login --token-stdin",
].join("\n");

export const loginCommand: Command = {
  name: "login",
  description: "Authenticate the CLI with your Bee account.",
  usage: USAGE,
  run: async (args, context) => {
    await handleLogin(args, context);
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
    token = await loginWithAppPairing(context, options.agent);
  }

  if (!token) {
    throw new Error("Missing token.");
  }

  token = token.trim();

  const user = await fetchClientMe(context, token);

  await saveToken(context.env, token);

  if (options.agent) {
    printAgentSuccessMessage(user);
  } else if (user) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    console.log(`Authenticated as ${name} (id ${user.id}).`);
  } else {
    console.log("Token stored.");
  }
}

function printAgentSuccessMessage(user: {
  id: number;
  first_name: string;
  last_name: string | null;
}): void {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");

  console.log("");
  console.log(`Great news! I'm now connected to the Bee account of ${name}.`);
  console.log("");
  console.log("Everything is set up and I'm ready to help you!");
}

function parseLoginArgs(args: readonly string[]): LoginOptions {
  let token: string | undefined;
  let tokenStdin = false;
  let agent = false;
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

    if (arg === "--agent") {
      agent = true;
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

  const options: LoginOptions = { tokenStdin, agent };
  if (token !== undefined) {
    options.token = token;
  }
  return options;
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

async function loginWithAppPairing(
  context: CommandContext,
  agentMode: boolean
): Promise<string> {
  if (!agentMode && !process.stdin.isTTY) {
    throw new Error(
      "Interactive login requires a TTY. Use --token or --token-stdin."
    );
  }

  if (agentMode) {
    return await loginWithAppPairingAgentMode(context);
  }

  const appId = getDefaultAppId(context.env);
  const keyPair = generateAppPairingKeyPair();
  const publicKey = keyPair.publicKeyBase64;
  const secretKey = keyPair.secretKey;
  const emoji = shouldShowEmojiHash()
    ? formatEmojiHash(keyPair.publicKeyBytes)
    : null;

  const initial = await requestAppPairing(context.env, appId, publicKey);

  if (initial.status === "completed") {
    return decryptAppPairingToken(initial.encryptedToken, secretKey);
  }

  if (initial.status === "expired") {
    throw new Error("Pairing request expired. Please try again.");
  }

  const pairingUrl = buildPairingUrl(initial.requestId);
  const method = await selectAuthMethod();
  await presentAppPairing(method, pairingUrl, initial.requestId, emoji);
  console.log("Waiting for authorization...");

  return await pollForAppToken({
    env: context.env,
    appId,
    publicKey,
    secretKey,
    expiresAt: initial.expiresAt,
  });
}

async function loginWithAppPairingAgentMode(
  context: CommandContext
): Promise<string> {
  const existingState = await loadPairingState(context.env);

  if (existingState) {
    const expiresAtMs = Date.parse(existingState.expiresAt);
    const isExpired = !Number.isNaN(expiresAtMs) && Date.now() >= expiresAtMs;

    if (!isExpired) {
      printAgentWelcomeMessage(existingState.pairingUrl, existingState.expiresAt, "resumed");

      const secretKey = Buffer.from(existingState.secretKey, "base64");
      try {
        const token = await pollForAppToken({
          env: context.env,
          appId: existingState.appId,
          publicKey: existingState.publicKey,
          secretKey: new Uint8Array(secretKey),
          expiresAt: existingState.expiresAt,
        });
        await clearPairingState(context.env);
        return token;
      } catch (error) {
        await clearPairingState(context.env);
        throw error;
      }
    }

    await clearPairingState(context.env);
  }

  const appId = getDefaultAppId(context.env);
  const keyPair = generateAppPairingKeyPair();
  const publicKey = keyPair.publicKeyBase64;
  const secretKey = keyPair.secretKey;

  const initial = await requestAppPairing(context.env, appId, publicKey);

  if (initial.status === "completed") {
    return decryptAppPairingToken(initial.encryptedToken, secretKey);
  }

  if (initial.status === "expired") {
    throw new Error("Pairing request expired. Please try again.");
  }

  const pairingUrl = buildPairingUrl(initial.requestId);

  const state: PairingState = {
    appId,
    publicKey,
    secretKey: Buffer.from(secretKey).toString("base64"),
    requestId: initial.requestId,
    pairingUrl,
    expiresAt: initial.expiresAt,
  };
  await savePairingState(context.env, state);

  const authStatus = existingState ? "reset" : "new";
  printAgentWelcomeMessage(pairingUrl, initial.expiresAt, authStatus);

  try {
    const token = await pollForAppToken({
      env: context.env,
      appId,
      publicKey,
      secretKey,
      expiresAt: initial.expiresAt,
    });
    await clearPairingState(context.env);
    return token;
  } catch (error) {
    throw error;
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

async function presentAppPairing(
  method: DeviceAuthMethod,
  pairingUrl: string,
  requestId: string,
  emojiHashValue: string | null
): Promise<void> {
  console.log(`Pairing request: ${requestId}`);
  console.log(`Open this URL to approve the app: ${pairingUrl}`);
  if (emojiHashValue) {
    console.log(`Emoji hash: ${emojiHashValue}`);
  }

  if (method === "browser") {
    const opened = await openBrowser(pairingUrl);
    if (!opened) {
      console.log("Unable to open the browser automatically.");
    }
    return;
  }

  const qrCode = await renderQrCode(pairingUrl);
  console.log(qrCode);
}

function formatEmojiHash(publicKeyBytes: Uint8Array): string | null {
  const emojis = emojiHash(publicKeyBytes, 4);
  if (emojis.length === 0) {
    return null;
  }
  return emojis.join(" ");
}

function shouldShowEmojiHash(): boolean {
  const value = process.env["BEE_EMOJI_HASH"]?.trim().toLowerCase();
  if (!value) {
    return false;
  }
  return ["1", "true", "on", "yes"].includes(value);
}

async function pollForAppToken(opts: {
  env: Environment;
  appId: string;
  publicKey: string;
  secretKey: Uint8Array;
  expiresAt: string;
}): Promise<string> {
  const expiresAtMs = Date.parse(opts.expiresAt);
  const deadline =
    Number.isNaN(expiresAtMs) || expiresAtMs <= 0
      ? Date.now() + 5 * 60 * 1000
      : expiresAtMs;
  const intervalMs = 2000;

  while (Date.now() < deadline) {
    const outcome = await requestAppPairing(
      opts.env,
      opts.appId,
      opts.publicKey
    );
    if (outcome.status === "completed") {
      return decryptAppPairingToken(
        outcome.encryptedToken,
        opts.secretKey
      );
    }
    if (outcome.status === "expired") {
      throw new Error("Pairing request expired. Please try again.");
    }
    await sleep(intervalMs);
  }

  throw new Error("Login timed out. Please try again.");
}

function buildPairingUrl(requestId: string): string {
  return `https://bee.computer/connect/${requestId}`;
}

function getDefaultAppId(env: Environment): string {
  if (env === "staging") {
    return "pk5z3uuzjpxj4f7frk6rsq2f";
  }
  return "ph9fssu1kv1b0hns69fxf7rx";
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

type AgentAuthStatus = "new" | "resumed" | "reset";

function printAgentWelcomeMessage(
  pairingUrl: string,
  expiresAt: string,
  status: AgentAuthStatus
): void {
  const expiresAtMs = Date.parse(expiresAt);
  const remainingMs = expiresAtMs - Date.now();
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));

  console.log("Welcome to Bee AI!");
  console.log("");

  if (status === "resumed") {
    console.log("[Resuming previous authentication session]");
    console.log("");
  } else if (status === "reset") {
    console.log("[Previous authentication expired - starting a new session]");
    console.log("");
  } else {
    console.log("[Starting new authentication session]");
    console.log("");
  }

  console.log(
    "This is an authentication flow for Bee CLI to connect a Bee account to it."
  );
  console.log("");
  console.log(
    "To complete authentication, the device owner must authorize this connection."
  );
  console.log("There are two ways to do this:");
  console.log("");
  console.log("  1. Click on the authentication link below to open it in a browser");
  console.log(
    "  2. Or visit the link on any device and scan the QR code shown on the page"
  );
  console.log("");
  console.log(`Authentication link: ${pairingUrl}`);
  console.log("");
  console.log(
    "Once the link is opened, follow the instructions to approve the connection."
  );
  console.log("");
  console.log(
    `This authentication request will expire in approximately ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`
  );
  console.log(
    "You can safely stop this process and restart it later to continue from where you left off,"
  );
  console.log("as long as the request has not expired.");
  console.log("");
  console.log("Now waiting for you to approve the connection using the link above...");
}
