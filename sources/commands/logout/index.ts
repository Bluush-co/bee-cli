import type { Command, CommandContext } from "@/commands/types";
import { clearToken } from "@/secureStore";

const USAGE = "bee logout";

export const logoutCommand: Command = {
  name: "logout",
  description: "Log out and clear stored credentials.",
  usage: USAGE,
  run: async (args, context) => {
    await handleLogout(args, context);
  },
};

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
