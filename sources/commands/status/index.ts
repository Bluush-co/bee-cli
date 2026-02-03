import type { Command, CommandContext } from "@/commands/types";
import { getEnvironmentConfig } from "@/environment";
import { loadToken } from "@/secureStore";
import { fetchClientMe } from "@/client/clientMe";

const USAGE = "bee status";

export const statusCommand: Command = {
  name: "status",
  description: "Show current authentication status.",
  usage: USAGE,
  run: async (args, context) => {
    await handleStatus(args, context);
  },
};

async function handleStatus(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  if (args.length > 0) {
    throw new Error("status does not accept arguments.");
  }

  const token = await loadToken(context.env);
  const config = getEnvironmentConfig(context.env);

  if (!token) {
    console.log("Not logged in.");
    console.log(`API: ${config.label} (${config.apiUrl})`);
    return;
  }

  console.log(`API: ${config.label} (${config.apiUrl})`);
  console.log(`Token: ${maskToken(token)}`);

  const user = await fetchClientMe(context, token);
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  console.log(`Verified as ${name} (id ${user.id}).`);
}

function maskToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 8) {
    return "********";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
