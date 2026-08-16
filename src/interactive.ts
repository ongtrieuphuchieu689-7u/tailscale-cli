import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function confirm(
  message: string,
  explicitYes: boolean,
): Promise<boolean> {
  if (
    explicitYes ||
    process.env.TS_CLI_YES === "true" ||
    process.env.TS_CLI_YES === "1"
  )
    return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${message} [y/N] `))
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function promptCredential(): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  if (process.env.TS_CLI_YES === "true" || process.env.TS_CLI_YES === "1")
    return undefined;
  const rl = createInterface({ input, output });
  try {
    const answer = (
      await rl.question(
        "No Tailscale credential found. Paste a tskey-client- trust credential (or press Enter to skip): ",
      )
    ).trim();
    return answer || undefined;
  } finally {
    rl.close();
  }
}
