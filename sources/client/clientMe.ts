import type { CommandContext } from "@/commands/types";

type ClientUser = {
  id: number;
  first_name: string;
  last_name: string | null;
};

export async function fetchClientMe(
  context: CommandContext,
  token: string
): Promise<ClientUser> {
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
    throw new Error("Invalid response from API.");
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
