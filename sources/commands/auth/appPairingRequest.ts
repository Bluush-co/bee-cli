import type { Environment } from "@/environment";

export type AppPairingRequest =
  | { status: "pending"; requestId: string; expiresAt: string }
  | { status: "completed"; requestId: string; encryptedToken: string }
  | { status: "expired"; requestId: string };

const PAIRING_API_URLS: Record<Environment, string> = {
  prod: "https://auth.beeai-services.com",
  staging: "https://public-api.korshaks.people.amazon.dev",
};

const PAIRING_PATH = "/apps/pairing/request";

export async function requestAppPairing(
  env: Environment,
  appId: string,
  publicKey: string,
  signal?: AbortSignal
): Promise<AppPairingRequest> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_id: appId, publicKey }),
  };
  if (signal) {
    init.signal = signal;
  }

  const response = await fetchPairing(env, init);

  if (!response.ok) {
    const errorPayload = await safeJson(response);
    const errorCode =
      typeof errorPayload?.["error"] === "string" ? errorPayload["error"] : null;
    if (response.status === 404 && (!errorCode || errorCode === "Not Found")) {
      throw new Error("Pairing endpoint not found.");
    }

    const message = errorCode ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  const data = await safeJson(response);
  if (data?.["ok"] !== true) {
    throw new Error("Invalid response from developer API.");
  }

  const status = data?.["status"];
  const requestId = data?.["requestId"];

  if (status === "pending") {
    const expiresAt = data?.["expiresAt"];
    if (typeof requestId !== "string" || typeof expiresAt !== "string") {
      throw new Error("Invalid response from developer API.");
    }
    return { status: "pending", requestId, expiresAt };
  }

  if (status === "completed") {
    const result = data?.["result"];
    const encryptedToken =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)["encryptedToken"]
        : null;
    if (typeof requestId !== "string" || typeof encryptedToken !== "string") {
      throw new Error("Invalid response from developer API.");
    }
    return { status: "completed", requestId, encryptedToken };
  }

  if (status === "expired") {
    if (typeof requestId !== "string") {
      throw new Error("Invalid response from developer API.");
    }
    return { status: "expired", requestId };
  }

  throw new Error("Invalid response from developer API.");
}

async function fetchPairing(
  env: Environment,
  init: RequestInit
): Promise<Response> {
  const url = new URL(PAIRING_PATH, PAIRING_API_URLS[env]);
  return fetch(url, init);
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
