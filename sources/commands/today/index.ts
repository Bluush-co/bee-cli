import type { Command } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";

const USAGE = "bee today";

export const todayCommand: Command = {
  name: "today",
  description: "Fetch today's brief (calendar events and emails).",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length > 0) {
      throw new Error(`Unexpected arguments: ${args.join(" ")}`);
    }

    const data = await requestClientJson(context, "/v1/todayBrief", {
      method: "GET",
    });
    printJson(data);
  },
};
