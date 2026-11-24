import { describe, expect, test } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { SIDEBAR_UNLABELLED_LABEL_KEY } from "@/stores/sidebar-view-store";
import { filterWorkspacesByLabels, labelWorkspaceGroups } from "./sidebar-labels";

function workspace(
  workspaceId: string,
  labels: string[],
  pinnedAt: string | null = null,
): SidebarWorkspaceEntry {
  return {
    workspaceKey: `host:${workspaceId}`,
    serverId: "host",
    workspaceId,
    projectViewKey: "project",
    projectName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory: `/repo/${workspaceId}`,
    workspaceDirectoryLabel: workspaceId,
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceId,
    title: null,
    pinnedAt,
    labels,
    currentBranch: "main",
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
}

describe("sidebar label filtering", () => {
  const workspaces = [
    workspace("one", ["Backend", "Urgent"], "2026-01-01"),
    workspace("two", ["Backend"]),
    workspace("three", []),
  ];

  function filtered(labels: string[]) {
    return filterWorkspacesByLabels({ workspaces, labels }).map((entry) => entry.workspaceId);
  }

  test("includes a workspace carrying any selected label", () => {
    expect(filtered([])).toEqual(["one", "two", "three"]);
    expect(filtered(["backend"])).toEqual(["one", "two"]);
    expect(filtered(["backend", "urgent"])).toEqual(["one", "two"]);
  });

  test("models Unlabelled as a row in the same list", () => {
    expect(filtered([SIDEBAR_UNLABELLED_LABEL_KEY])).toEqual(["three"]);
    expect(filtered(["backend", SIDEBAR_UNLABELLED_LABEL_KEY])).toEqual(["one", "two", "three"]);
  });

  test("reads whitespace-only label names as no label rather than as the Unlabelled key", () => {
    expect(
      filterWorkspacesByLabels({
        workspaces: [workspace("blank", ["   "])],
        labels: [SIDEBAR_UNLABELLED_LABEL_KEY],
      }).map((entry) => entry.workspaceId),
    ).toEqual(["blank"]);
  });
});

describe("sidebar label grouping", () => {
  test("groups across projects and hosts, normalizes names, and retains unlabelled workspaces", () => {
    const one = workspace("one", [" Backend ", "backend", "Urgent"]);
    const two = {
      ...workspace("two", ["BACKEND"]),
      serverId: "other",
      workspaceKey: "other:two",
      projectViewKey: "other-project",
    };
    const three = workspace("three", ["  "]);
    expect(
      labelWorkspaceGroups([one, two, three], "Unlabelled").map((group) => ({
        key: group.key,
        label: group.label,
        ids: group.rows.map(readWorkspaceId),
      })),
    ).toEqual([
      { key: "label:backend", label: "Backend", ids: ["one", "two"] },
      { key: "label:urgent", label: "Urgent", ids: ["one"] },
      { key: "label:", label: "Unlabelled", ids: ["three"] },
    ]);
    expect(labelWorkspaceGroups([], "Unlabelled")).toEqual([]);
  });
});

function readWorkspaceId(row: SidebarWorkspaceEntry): string {
  return row.workspaceId;
}

test("nests product areas and suppresses duplicate membership at the theme level", () => {
  const bob = workspace("bob", ["BuildBetter", "BuildBetter/Bob", "BuildBetter/Bob"]);
  const chat = workspace("chat", ["BuildBetter/AI Chat"]);
  const general = workspace("general", ["BuildBetter"]);
  const groups = labelWorkspaceGroups([bob, chat, general], "Unlabelled");
  expect(groups).toHaveLength(1);
  expect(groups[0].key).toBe("label:buildbetter");
  expect(groups[0].rows.map(readWorkspaceId)).toEqual(["general"]);
  const children = groups[0].children!;
  expect(children.map((group) => group.label)).toEqual(["AI Chat", "Bob"]);
  expect(children[0].rows.map(readWorkspaceId)).toEqual(["chat"]);
  expect(children[1].rows.map(readWorkspaceId)).toEqual(["bob"]);
});
