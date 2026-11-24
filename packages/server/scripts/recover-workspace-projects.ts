import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import pino from "pino";
import { z } from "zod";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  PersistedProjectRecordSchema,
  PersistedWorkspaceRecordSchema,
} from "../src/server/workspace-registry.js";
import {
  applyWorkspaceProjectRecovery,
  planWorkspaceProjectRecovery,
  WorkspaceProjectRecoverySchema,
} from "../src/server/workspace-registry-recovery.js";
import { deriveProjectKey } from "../src/server/project-key.js";
import { writeJsonFileAtomic } from "../src/server/atomic-file.js";

const { values } = parseArgs({
  options: {
    home: { type: "string" },
    backup: { type: "string" },
    out: { type: "string" },
    apply: { type: "string" },
  },
});
if (!values.home)
  throw new Error("Pass --home explicitly; this command never selects a daemon implicitly");
const home = path.resolve(values.home);
const registryDirectory = path.join(home, "projects");
const logger = pino();
const run = promisify(execFile);

if (values.apply) {
  await requireStoppedDaemon(home);
  const plan = WorkspaceProjectRecoverySchema.parse(await readJson(values.apply));
  const projects = new FileBackedProjectRegistry(
    path.join(registryDirectory, "projects.json"),
    logger,
  );
  const workspaces = new FileBackedWorkspaceRegistry(
    path.join(registryDirectory, "workspaces.json"),
    logger,
  );
  // Fail before registry initialization: registry loaders log invalid JSON and continue empty.
  z.array(PersistedProjectRecordSchema).parse(
    await readJson(path.join(registryDirectory, "projects.json")),
  );
  z.array(PersistedWorkspaceRecordSchema).parse(
    await readJson(path.join(registryDirectory, "workspaces.json")),
  );
  const snapshot = path.join(home, "recovery", `before-${Date.now()}`);
  await fs.mkdir(snapshot, { recursive: true, mode: 0o700 });
  await fs.cp(registryDirectory, path.join(snapshot, "projects"), { recursive: true });
  await requireStoppedDaemon(home);
  await applyWorkspaceProjectRecovery({ plan, projects, workspaces });
  logger.info({ snapshot, assignments: plan.assignments.length }, "Project membership recovered");
} else {
  if (!values.backup || !values.out) throw new Error("Preview requires --backup and --out");
  const plan = planWorkspaceProjectRecovery({
    projects: z
      .array(PersistedProjectRecordSchema)
      .parse(await readJson(path.join(registryDirectory, "projects.json"))),
    workspaces: z
      .array(PersistedWorkspaceRecordSchema)
      .parse(await readJson(path.join(registryDirectory, "workspaces.json"))),
    backup: z.array(PersistedWorkspaceRecordSchema).parse(await readJson(values.backup)),
  });
  for (const project of plan.projects) {
    if (project.projectKey) continue;
    let remoteUrl: string | null = null;
    try {
      await run("git", ["-C", project.rootPath, "rev-parse", "--git-dir"], { timeout: 5000 });
      project.kind = "git";
      const result = await run(
        "git",
        ["-C", project.rootPath, "config", "--get", "remote.origin.url"],
        { timeout: 5000 },
      ).catch(() => null);
      remoteUrl = result?.stdout.trim() || null;
    } catch {
      // Deleted directories remain recoverable with unknown equivalence metadata.
      project.kind = "non_git";
    }
    project.projectKey = deriveProjectKey({
      rootPath: project.rootPath,
      remoteUrl,
      worktreeRoot: null,
      mainRepoRoot: null,
    });
  }
  await writeJsonFileAtomic(path.resolve(values.out), plan);
  logger.info(
    { projects: plan.projects.length, assignments: plan.assignments.length, out: values.out },
    "Recovery preview saved; daemon unchanged",
  );
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function requireStoppedDaemon(directory: string): Promise<void> {
  let raw: unknown;
  try {
    raw = await readJson(path.join(directory, "paseo.pid"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const { pid } = z.object({ pid: z.number().int().positive() }).parse(raw);
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
    throw error;
  }
  throw new Error(`Refusing to write ${directory}: daemon PID ${pid} is running`);
}
