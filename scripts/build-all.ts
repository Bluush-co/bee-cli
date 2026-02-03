import { mkdir } from "node:fs/promises";
import path from "node:path";

type BuildTarget = {
  name: string;
  bunTarget: string;
  outputName: string;
};

const TARGETS: BuildTarget[] = [
  { name: "linux-x64", bunTarget: "bun-linux-x64", outputName: "bee" },
  { name: "linux-arm64", bunTarget: "bun-linux-arm64", outputName: "bee" },
  { name: "mac-x64", bunTarget: "bun-darwin-x64", outputName: "bee" },
  { name: "mac-arm64", bunTarget: "bun-darwin-arm64", outputName: "bee" },
  { name: "windows-x64", bunTarget: "bun-windows-x64", outputName: "bee.exe" },
  { name: "windows-arm64", bunTarget: "bun-windows-arm64", outputName: "bee.exe" },
];

async function run(): Promise<void> {
  const root = process.cwd();
  const entry = path.join(root, "sources", "main.ts");
  const distRoot = path.join(root, "dist", "platforms");

  for (const target of TARGETS) {
    const outDir = path.join(distRoot, target.name);
    await mkdir(outDir, { recursive: true });
    const outfile = path.join(outDir, target.outputName);

    console.log(`\nBuilding ${target.name} -> ${outfile}`);
    await runCommand([
      "bun",
      "build",
      entry,
      "--compile",
      `--target=${target.bunTarget}`,
      "--outfile",
      outfile,
    ]);
  }
}

async function runCommand(cmd: string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")}`);
  }
}

void run();
