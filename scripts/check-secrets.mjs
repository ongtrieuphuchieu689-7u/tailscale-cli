import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { findSecrets } from "./secret-pattern.mjs";

const ROOTS = ["dist", "docs", "README.md", "LICENSE"];

async function collectFiles(path, out) {
  const info = await stat(path);
  if (info.isFile()) {
    out.push(path);
    return;
  }
  for (const entry of await readdir(path)) {
    if (entry === "node_modules") continue;
    await collectFiles(join(path, entry), out);
  }
}

async function main() {
  const files = [];
  for (const root of ROOTS) {
    try {
      await collectFiles(root, files);
    } catch (error) {
      console.error(`SKIP missing ${root}: ${error.message}`);
    }
  }

  let violations = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const secrets = findSecrets(text);
    for (const secret of secrets) {
      console.error(`SECRET ${relative(process.cwd(), file)}: ${secret}`);
      violations += 1;
    }
  }

  if (violations > 0) {
    console.error(
      `check-secrets: ${violations} potential Tailscale credential(s) in publish artifact — remove or mask them`,
    );
    process.exit(1);
  }
  console.log(`check-secrets: clean (${files.length} files scanned)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
