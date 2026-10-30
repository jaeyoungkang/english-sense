import fs from "node:fs/promises";
import path from "node:path";
import {
  reconcileBundleIntoCanonical,
  verifyCanonicalProcessFile,
  type CanonicalProcessFile,
  type WebProcessAckReceipt,
} from "../lib/process-bundle";

export const WEB_PROCESS_RELATIVE_DIR = path.join("learn", "english-as-germanic", "web-process");

export async function readExistingCanonicalFiles(studyRootDir: string): Promise<CanonicalProcessFile[]> {
  const targetDir = path.join(studyRootDir, WEB_PROCESS_RELATIVE_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(targetDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: CanonicalProcessFile[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(targetDir, name), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    files.push(await verifyCanonicalProcessFile(parsed));
  }
  return files;
}

export async function importBundleToStudyDirectory(
  rawBundle: unknown,
  options: {
    studyRootDir: string;
    expectedOwnerId: string;
    importedAt?: string;
  },
): Promise<{
  status: "imported" | "already_imported";
  filePath: string;
  canonicalFile: CanonicalProcessFile;
  ack: WebProcessAckReceipt;
}> {
  const existing = await readExistingCanonicalFiles(options.studyRootDir);
  const reconciled = await reconcileBundleIntoCanonical(rawBundle, existing, {
    expectedOwnerId: options.expectedOwnerId,
    importedAt: options.importedAt,
  });
  const targetDir = path.join(options.studyRootDir, WEB_PROCESS_RELATIVE_DIR);
  const filePath = path.join(targetDir, `${reconciled.canonicalFile.bundleId}.json`);

  if (reconciled.status === "imported") {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(reconciled.canonicalFile, null, 2)}\n`, { encoding: "utf-8", flag: "wx" });
  }

  return {
    status: reconciled.status,
    filePath,
    canonicalFile: reconciled.canonicalFile,
    ack: reconciled.ack,
  };
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const bundleFile = getArg("--bundle-file");
  const studyDir = getArg("--study-dir");
  const ownerId = getArg("--owner-id") ?? process.env.CF_ACCESS_OWNER_ID ?? "learner-owner";
  const ackOut = getArg("--ack-out");

  if (!bundleFile || !studyDir) {
    throw new Error("사용법: npx tsx scripts/sync-study-records.ts --bundle-file <bundle.json> --study-dir <study-and-learn-dir> [--owner-id <ownerId>] [--ack-out <ack.json>]");
  }

  const rawBundle = JSON.parse(await fs.readFile(path.resolve(bundleFile), "utf-8")) as unknown;
  const result = await importBundleToStudyDirectory(rawBundle, {
    studyRootDir: path.resolve(studyDir),
    expectedOwnerId: ownerId,
  });

  if (ackOut) {
    await fs.writeFile(path.resolve(ackOut), `${JSON.stringify(result.ack, null, 2)}\n`, "utf-8");
  }
  console.log(JSON.stringify({ status: result.status, filePath: result.filePath, ack: result.ack }));
}

if (process.argv[1] && /(?:^|[\\/])sync-study-records\.[tj]s$/.test(process.argv[1])) {
  runCli().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
