export type Command = {
  name: string;
  description: string;
  usage: string;
  aliases?: readonly string[];
  run: (args: readonly string[]) => Promise<void>;
};
