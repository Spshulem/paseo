import path from "node:path";
import { z } from "zod";
import { getRealpathAwareRelativePath } from "../utils/path.js";
import {
  createPersistedProjectRecord,
  PersistedProjectRecordSchema,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "./workspace-registry.js";

export const WorkspaceProjectRecoverySchema = z.object({
  projects: z.array(PersistedProjectRecordSchema),
  assignments: z.array(
    z.object({
      workspaceId: z.string(),
      cwd: z.string(),
      expectedProjectId: z.string(),
      projectId: z.string(),
    }),
  ),
});

export type WorkspaceProjectRecovery = z.infer<typeof WorkspaceProjectRecoverySchema>;

/** Restores identity from a backup; inferred roots must be reviewed before applying the plan. */
export function planWorkspaceProjectRecovery(input: {
  workspaces: PersistedWorkspaceRecord[];
  backup: PersistedWorkspaceRecord[];
  projects: z.infer<typeof PersistedProjectRecordSchema>[];
}): WorkspaceProjectRecovery {
  const backupById = new Map(input.backup.map((workspace) => [workspace.workspaceId, workspace]));
  const projects = new Map(input.projects.map((project) => [project.projectId, project]));
  const sources = new Map<string, PersistedWorkspaceRecord[]>();
  const assignments: WorkspaceProjectRecovery["assignments"] = [];
  for (const workspace of input.workspaces) {
    const original = backupById.get(workspace.workspaceId);
    if (original && original.cwd !== workspace.cwd) {
      throw new Error(`Workspace cwd differs from backup: ${workspace.workspaceId}`);
    }
    const source = original ?? workspace;
    const siblings = sources.get(source.projectId) ?? [];
    siblings.push(source);
    sources.set(source.projectId, siblings);
    if (workspace.projectId !== source.projectId) {
      assignments.push({
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        expectedProjectId: workspace.projectId,
        projectId: source.projectId,
      });
    }
  }
  for (const [projectId, workspaces] of sources) {
    if (projects.has(projectId)) continue;
    const roots = workspaces
      .map(recoveryProjectRoot)
      .sort((left, right) => left.length - right.length);
    const rootPath = roots[0];
    if (!roots.every((root) => isWithinRoot(rootPath, root))) {
      throw new Error(`Conflicting roots for ${projectId}: ${roots.join(", ")}`);
    }
    const createdAt = workspaces.map((workspace) => workspace.createdAt).sort()[0];
    const updatedAt = workspaces
      .map((workspace) => workspace.updatedAt)
      .sort()
      .at(-1)!;
    projects.set(
      projectId,
      createPersistedProjectRecord({
        projectId,
        rootPath,
        kind: workspaces.some((workspace) => workspace.kind !== "directory") ? "git" : "non_git",
        displayName: path.basename(rootPath),
        projectKey: null,
        createdAt,
        updatedAt,
      }),
    );
  }
  return WorkspaceProjectRecoverySchema.parse({
    projects: Array.from(projects.values()),
    assignments,
  });
}

function recoveryProjectRoot(workspace: PersistedWorkspaceRecord): string {
  if (!workspace.mainRepoRoot || !workspace.worktreeRoot) return path.resolve(workspace.cwd);
  const relative = getRealpathAwareRelativePath(workspace.worktreeRoot, workspace.cwd);
  if (relative === null) {
    throw new Error(`Workspace outside backing checkout: ${workspace.workspaceId}`);
  }
  return path.resolve(workspace.mainRepoRoot, relative);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Caller must own exclusive access to the daemon home. Never overwrite unrelated workspace fields. */
export async function applyWorkspaceProjectRecovery(input: {
  plan: WorkspaceProjectRecovery;
  projects: ProjectRegistry;
  workspaces: WorkspaceRegistry;
}): Promise<void> {
  const plan = WorkspaceProjectRecoverySchema.parse(input.plan);
  const projectIds = new Set(plan.projects.map((project) => project.projectId));
  for (const assignment of plan.assignments) {
    const workspace = await input.workspaces.get(assignment.workspaceId);
    if (!workspace || workspace.cwd !== assignment.cwd) {
      throw new Error(`Workspace changed since planning: ${assignment.workspaceId}`);
    }
    if (
      workspace.projectId !== assignment.expectedProjectId &&
      workspace.projectId !== assignment.projectId
    ) {
      throw new Error(`Workspace membership changed since planning: ${assignment.workspaceId}`);
    }
    if (
      !projectIds.has(assignment.projectId) &&
      !(await input.projects.get(assignment.projectId))
    ) {
      throw new Error(`Recovery project missing: ${assignment.projectId}`);
    }
  }
  for (const project of plan.projects) {
    const existing = await input.projects.get(project.projectId);
    if (existing && existing.rootPath !== project.rootPath) {
      throw new Error(`Project root changed since planning: ${project.projectId}`);
    }
  }
  // Projects first: a partial application never creates a new dangling workspace reference.
  for (const project of plan.projects) {
    if (!(await input.projects.get(project.projectId))) await input.projects.upsert(project);
  }
  for (const assignment of plan.assignments) {
    await input.workspaces.update(assignment.workspaceId, (workspace) => ({
      ...workspace,
      projectId: assignment.projectId,
    }));
  }
}
