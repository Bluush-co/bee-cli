import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  formatRecordMarkdown,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE =
  "bee search conversations --query <text> [--limit N] [--since <epochMs>] [--until <epochMs>] [--json]";

export const searchCommand: Command = {
  name: "search",
  description: "Search developer data.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use conversations.");
    }

    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "conversations":
        await handleConversations(rest, context);
        return;
      default:
        throw new Error(`Unknown search subcommand: ${subcommand}`);
    }
  },
};

type ConversationsOptions = {
  query: string;
  limit?: number;
  since?: number;
  until?: number;
};

async function handleConversations(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseConversationsArgs(remaining);
  const body: { query: string; limit?: number; since?: number; until?: number } =
    {
      query: options.query,
    };

  if (options.limit !== undefined) {
    body.limit = options.limit;
  }
  if (options.since !== undefined) {
    body.since = options.since;
  }
  if (options.until !== undefined) {
    body.until = options.until;
  }

  const data = await requestClientJson(
    context,
    "/v1/search/conversations/neural",
    {
      method: "POST",
      json: body,
    }
  );
  if (format === "json") {
    printJson(data);
    return;
  }

  const nowMs = Date.now();
  const payload = parseSearchConversations(data);
  if (!payload) {
    const timeZone = resolveTimeZone(parseSearchTimezone(data));
    console.log(
      formatRecordMarkdown({
        title: "Conversation Search Results",
        record: normalizeRecord(data),
        timeZone,
        nowMs,
      })
    );
    return;
  }

  const lines: string[] = ["# Conversation Search Results", ""];
  if (payload.conversations.length === 0) {
    lines.push("- (none)", "");
  } else {
    const timeZone = resolveTimeZone(payload.timezone);
    for (const conversation of payload.conversations) {
      lines.push(
        formatRecordMarkdown({
          title: `Conversation ${conversation.id ?? "unknown"}`,
          record: normalizeConversationRecord(conversation),
          timeZone,
          nowMs,
          headingLevel: 3,
        }).trimEnd()
      );
      lines.push("");
    }
  }

  if (payload.total !== null) {
    lines.push("-----", "");
    lines.push("## Summary", "");
    lines.push(`- total: ${payload.total}`, "");
  }

  console.log(lines.join("\n"));
}

function parseConversationsArgs(args: readonly string[]): ConversationsOptions {
  let query: string | undefined;
  let limit: number | undefined;
  let since: number | undefined;
  let until: number | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--query") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--query requires a value");
      }
      query = value;
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--limit requires a value");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      limit = parsed;
      i += 1;
      continue;
    }

    if (arg === "--cursor") {
      throw new Error("--cursor is no longer supported. Use --since/--until.");
    }

    if (arg === "--since") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--since requires a value");
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error("--since must be a valid epoch timestamp");
      }
      since = parsed;
      i += 1;
      continue;
    }

    if (arg === "--until") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--until requires a value");
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error("--until must be a valid epoch timestamp");
      }
      until = parsed;
      i += 1;
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

  if (!query) {
    throw new Error("Missing query. Provide --query.");
  }

  const options: ConversationsOptions = { query };
  if (limit !== undefined) {
    options.limit = limit;
  }
  if (since !== undefined) {
    options.since = since;
  }
  if (until !== undefined) {
    options.until = until;
  }

  return options;
}

type ConversationSearchItem = Record<string, unknown> & {
  id?: number | string;
};

function normalizeConversationRecord(
  conversation: ConversationSearchItem
): Record<string, unknown> {
  const record: Record<string, unknown> = { ...conversation };
  const hasDetailed = Object.prototype.hasOwnProperty.call(
    record,
    "detailed_summary"
  );
  const hasShort = Object.prototype.hasOwnProperty.call(record, "short_summary");
  const detailedRaw = record["detailed_summary"];
  const shortRaw = record["short_summary"];

  delete record["detailed_summary"];
  delete record["short_summary"];

  const detailedText = normalizeSummaryText(detailedRaw);
  const shortText = normalizeSummaryText(shortRaw);
  const summary = detailedText ?? shortText ?? "(no explicit answer)";

  const fields = normalizeFieldsRecord(record["fields"]);
  fields["summary"] = summary;
  if (hasDetailed) {
    fields["detailed_summary"] = detailedRaw;
  }
  if (hasShort) {
    fields["short_summary"] = shortRaw;
  }
  record["fields"] = fields;

  return record;
}

function normalizeSummaryText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFieldsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (value !== undefined) {
    return { value };
  }
  return {};
}

function parseSearchConversations(
  payload: unknown
): {
  conversations: ConversationSearchItem[];
  total: number | null;
  timezone: string | null;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as {
    results?: unknown;
    total?: unknown;
    timezone?: unknown;
  };
  if (!Array.isArray(data.results)) {
    return null;
  }
  return {
    conversations: data.results as ConversationSearchItem[],
    total: typeof data.total === "number" ? data.total : null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function parseSearchTimezone(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { timezone?: unknown };
  return typeof record.timezone === "string" ? record.timezone : null;
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}
