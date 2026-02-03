import type { CommandContext } from "@/commands/types";
import { loadToken } from "@/secureStore";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonRequestInit = RequestInit & {
  json?: JsonValue;
};

export async function requireClientToken(context: CommandContext): Promise<string> {
  const token = await loadToken(context.env);
  if (!token) {
    throw new Error('Not logged in. Run "bee login" first.');
  }
  return token;
}

export async function requestClientJson(
  context: CommandContext,
  path: string,
  init: JsonRequestInit = {}
): Promise<unknown> {
  const token = await requireClientToken(context);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }

  const response = await context.client.fetch(path, {
    ...init,
    headers,
    body,
  });

  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    const message = extractErrorMessage(data) ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export function printJson(value: unknown): void {
  const payload = value === undefined ? null : value;
  console.log(JSON.stringify(payload, null, 2));
}

function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }

  if (
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }

  return null;
}
