import { i18n } from "@/i18n/i18next";
import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarProjection } from "./sidebar-projection";
import { createRecentConversationsSelector, type RecentAgent } from "./sidebar-recents";

function recentAgent(id: string, sentAt: number | null, workspaceId = "one"): RecentAgent {
  return {
    id,
    title: id,
    workspaceId,
    lastUserMessageAt: sentAt === null ? null : new Date(sentAt),
  };
}

describe("recent conversations", () => {
  it("orders individual chats by the user's message, not provider activity or workspace", () => {
    const select = createRecentConversationsSelector();
    const agents = new Map([
      ["old", { ...recentAgent("old", 10), updatedAt: new Date(9999) }],
      ["new", { ...recentAgent("new", 20), updatedAt: new Date(20) }],
    ]);
    const workspace = makeWorkspace("one").entry;
    const result = select(
      { srv: { agents, queuedMessages: new Map() } },
      new Map([[workspace.workspaceKey, workspace]]),
    );
    expect(result.map((row) => row.agentId)).toEqual(["new", "old"]);
    expect(result[0]).toMatchObject({ serverId: "srv", workspaceId: "one", agentId: "new" });
  });

  it("includes queued sends immediately and excludes hidden, archived and unmessaged chats", () => {
    const select = createRecentConversationsSelector();
    const agents = new Map([
      ["queued", recentAgent("queued", null)],
      ["sent", recentAgent("sent", 20)],
      ["empty", recentAgent("empty", null)],
      ["invalid", recentAgent("invalid", NaN)],
      ["archived", { ...recentAgent("archived", 999), archivedAt: new Date(1000) }],
      ["hidden", { ...recentAgent("hidden", 999), background: true }],
      ["filtered", recentAgent("filtered", 999, "other")],
    ]);
    const queuedMessages = new Map([
      ["queued", [{ id: "q", text: "hi", attachments: [], queuedAt: 30 }]],
    ]);
    const workspace = makeWorkspace("one").entry;
    expect(
      select(
        { srv: { agents, queuedMessages } },
        new Map([[workspace.workspaceKey, workspace]]),
      ).map((row) => row.agentId),
    ).toEqual(["queued", "sent"]);
  });

  it("keeps identical agent IDs on different hosts separate and applies workspace filters", () => {
    const select = createRecentConversationsSelector();
    const a = makeWorkspace("one").entry;
    const b = { ...a, serverId: "other", workspaceKey: "other:one" };
    const session = {
      agents: new Map([["same", recentAgent("same", 10)]]),
      queuedMessages: new Map(),
    };
    const sessions = { srv: session, other: session };
    expect(
      select(
        sessions,
        new Map([
          [a.workspaceKey, a],
          [b.workspaceKey, b],
        ]),
      ),
    ).toHaveLength(2);
    expect(select(sessions, new Map([[b.workspaceKey, b]])).map((row) => row.serverId)).toEqual([
      "other",
    ]);
  });

  it("retains references during streaming and status updates, but updates after a send", () => {
    const select = createRecentConversationsSelector();
    const workspace = makeWorkspace("one").entry;
    const workspaces = new Map([[workspace.workspaceKey, workspace]]);
    const agents = new Map([["a", recentAgent("a", 10)]]);
    const queuedMessages = new Map();
    const result = select({ srv: { agents, queuedMessages } }, workspaces);
    expect(select({ srv: { agents, queuedMessages } }, workspaces)).toBe(result);
    expect(select({ srv: { agents: new Map(agents), queuedMessages } }, workspaces)).toBe(result);
    expect(
      select(
        { srv: { agents: new Map([["a", recentAgent("a", 20)]]), queuedMessages } },
        workspaces,
      )[0].sentAt,
    ).toBe(20);
  });

  it("bounds the list to the twenty most recent chats", () => {
    const select = createRecentConversationsSelector();
    const workspace = makeWorkspace("one").entry;
    const agents = new Map(
      Array.from({ length: 30 }, (_, index) => [
        String(index),
        recentAgent(String(index), index + 1),
      ]),
    );
    const rows = select(
      { srv: { agents, queuedMessages: new Map() } },
      new Map([[workspace.workspaceKey, workspace]]),
    );
    expect(rows).toHaveLength(20);
    expect(rows[0].agentId).toBe("29");
    expect(rows[19].agentId).toBe("10");
  });
});

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: {
  groupMode?: "project" | "status" | "label" | "status_label";
  pinnedCollapsed?: boolean;
}) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
    t: i18n.t,
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: "project" | "status") {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

describe("buildSidebarProjection", () => {
  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });
});

it("label grouping excludes pins and collapsed buckets from shortcuts and deduplicates multi-label rows", () => {
  const input = projectionInput({ groupMode: "label" });
  const shared = makeWorkspace("shared", "running", ["Backend", "Urgent"]);
  const unlabelled = makeWorkspace("plain");
  input.workspaceEntriesByKey.set(shared.entry.workspaceKey, shared.entry);
  input.workspaceEntriesByKey.set(unlabelled.entry.workspaceKey, unlabelled.entry);
  input.collapsedWorkspaceGroupKeys.add("label:backend");
  const projection = buildSidebarProjection(input);
  expect(projection.workspaceGroups.map((group) => group.key)).toEqual([
    "label:backend",
    "label:urgent",
    "label:",
  ]);
  expect(projection.shortcutModel.shortcutTargets.map((target) => target.workspaceId)).toEqual([
    "pinned",
    "shared",
    "unpinned",
    "plain",
  ]);
  input.collapsedWorkspaceGroupKeys.clear();
  expect(
    buildSidebarProjection(input).shortcutModel.shortcutTargets.map((target) => target.workspaceId),
  ).toEqual(["pinned", "shared", "unpinned", "plain"]);
});

it("excludes collapsed product areas and entire collapsed themes from keyboard navigation", () => {
  const input = projectionInput({ groupMode: "label", pinnedCollapsed: true });
  const bob = makeWorkspace("bob", "running", ["BuildBetter/Bob"]);
  const chat = makeWorkspace("chat", "running", ["BuildBetter/AI Chat"]);
  input.workspaceEntriesByKey = new Map([
    [bob.entry.workspaceKey, bob.entry],
    [chat.entry.workspaceKey, chat.entry],
  ]);
  input.collapsedWorkspaceGroupKeys.add("label:buildbetter/bob");
  expect(
    buildSidebarProjection(input).shortcutModel.shortcutTargets.map((target) => target.workspaceId),
  ).toEqual(["chat"]);
  input.collapsedWorkspaceGroupKeys.add("label:buildbetter");
  expect(buildSidebarProjection(input).shortcutModel.shortcutTargets).toEqual([]);
});

it("groups themes independently within status and keeps uncategorized workspaces reachable", () => {
  const input = projectionInput({ groupMode: "status_label", pinnedCollapsed: true });
  const needsBob = makeWorkspace("needs-bob", "needs_input", ["BuildBetter/Bob"]);
  const workingBob = makeWorkspace("working-bob", "running", ["BuildBetter/Bob"]);
  const plain = makeWorkspace("plain", "needs_input");
  input.workspaceEntriesByKey = new Map(
    [needsBob, workingBob, plain].map(({ entry }) => [entry.workspaceKey, entry]),
  );
  const projection = buildSidebarProjection(input);
  expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input", "running"]);
  const needs = projection.workspaceGroups[0]!;
  expect(needs.rows).toEqual([]);
  expect(needs.children?.map((group) => group.key)).toEqual([
    "needs_input:label:buildbetter",
    "needs_input:label:",
  ]);
  expect(needs.children?.[0]?.children?.[0]?.rows[0]?.workspaceId).toBe("needs-bob");
  input.collapsedWorkspaceGroupKeys.add("needs_input:label:buildbetter");
  expect(
    buildSidebarProjection(input).shortcutModel.shortcutTargets.map((target) => target.workspaceId),
  ).toEqual(["plain", "working-bob"]);
  input.collapsedWorkspaceGroupKeys.add("needs_input");
  expect(
    buildSidebarProjection(input).shortcutModel.shortcutTargets.map((target) => target.workspaceId),
  ).toEqual(["working-bob"]);
});
