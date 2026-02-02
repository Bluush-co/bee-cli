type BrowserCommand = {
  cmd: string[];
};

function commandForPlatform(url: string): BrowserCommand | null {
  switch (process.platform) {
    case "darwin":
      return { cmd: ["open", url] };
    case "win32":
      return { cmd: ["cmd", "/c", "start", "", url] };
    default:
      return { cmd: ["xdg-open", url] };
  }
}

export async function openBrowser(url: string): Promise<boolean> {
  const command = commandForPlatform(url);
  if (!command) {
    return false;
  }

  const child = Bun.spawn({
    cmd: command.cmd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  const exitCode = await child.exited;
  return exitCode === 0;
}
