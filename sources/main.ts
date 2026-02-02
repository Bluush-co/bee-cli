import type { Command } from "@/commands/types";
import { authCommand } from "@/commands/auth";
import { pingCommand } from "@/commands/ping";
import { versionCommand } from "@/commands/version";

const BIN = "bee";

const commands = [authCommand, pingCommand, versionCommand] satisfies readonly Command[];

const commandIndex = new Map<string, Command>();
for (const command of commands) {
  commandIndex.set(command.name, command);
  if (command.aliases) {
    for (const alias of command.aliases) {
      commandIndex.set(alias, command);
    }
  }
}

function isHelpFlag(value: string): boolean {
  return value === "-h" || value === "--help";
}

function printHelp(): void {
  console.log(`${BIN} <command> [options]`);
  console.log("");
  console.log("Commands:");

  for (const command of commands) {
    const aliasText = command.aliases && command.aliases.length > 0
      ? ` (aliases: ${command.aliases.join(", ")})`
      : "";
    console.log(`  ${command.name}  ${command.description}${aliasText}`);
  }

  console.log("");
  console.log(`Run \"${BIN} <command> --help\" for command-specific help.`);
}

function printCommandHelp(command: Command): void {
  console.log(command.usage);
  console.log("");
  console.log(command.description);
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  if (!firstArg || isHelpFlag(firstArg)) {
    printHelp();
    return;
  }

  if (firstArg === "--version" || firstArg === "-v") {
    await versionCommand.run([]);
    return;
  }

  const commandName = firstArg;
  const command = commandIndex.get(commandName);

  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const commandArgs = args.slice(1);
  if (commandArgs.some(isHelpFlag)) {
    printCommandHelp(command);
    return;
  }

  try {
    await command.run(commandArgs);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("Unexpected error");
    }
    printCommandHelp(command);
    process.exitCode = 1;
  }
}

void runCli();
