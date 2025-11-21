import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";
import { resetTests, runRegisteredTests } from "./runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isTestFile(filePath) {
  return filePath.endsWith(".test.js") || filePath.endsWith(".spec.js");
}

function shouldSkip(direntName) {
  return ["node_modules", "vendor"].includes(direntName);
}

function collectTestFiles(baseDir) {
  const pending = [baseDir];
  const files = [];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (shouldSkip(entry.name)) continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile() && isTestFile(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export async function run() {
  const baseDir = process.cwd();
  const files = collectTestFiles(baseDir);
  let failed = 0;

  for (const file of files) {
    resetTests();
    await import(pathToFileURL(file));
    console.log(`\nArchivo: ${path.relative(baseDir, file)}`);
    const result = await runRegisteredTests();
    failed += result.failed;
  }

  if (files.length === 0) {
    console.log("No se encontraron archivos de prueba.");
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}
