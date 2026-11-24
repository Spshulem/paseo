import {
  normalizeWorkspaceLabelName,
  workspaceLabelKey,
} from "@getpaseo/protocol/workspace-labels";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { SIDEBAR_UNLABELLED_LABEL_KEY, type SidebarLabelFilter } from "@/stores/sidebar-view-store";
import type { StatusBucket, StatusGroup } from "@/hooks/sidebar-status-view-model";

export interface SidebarWorkspaceGroup {
  key: string;
  label: string;
  rows: SidebarWorkspaceEntry[];
  children?: SidebarWorkspaceGroup[];
  leading: { kind: "status"; bucket: StatusBucket } | { kind: "label" };
}

export function statusWorkspaceGroups(groups: readonly StatusGroup[]): SidebarWorkspaceGroup[] {
  return groups.map((group) => ({
    key: group.bucket,
    label: group.label,
    rows: group.rows,
    leading: { kind: "status", bucket: group.bucket },
  }));
}

/**
 * Applies the Labels page's selection to the sidebar.
 *
 * `Unlabelled` is a row like any other, so it is a key in the same list rather than a boolean
 * beside it; the only thing that makes it special is what the key asks of a workspace.
 * Selecting several labels includes workspaces carrying any of them.
 */
export function filterWorkspacesByLabels(
  input: { workspaces: readonly SidebarWorkspaceEntry[] } & SidebarLabelFilter,
): SidebarWorkspaceEntry[] {
  const { workspaces, labels } = input;
  if (labels.length === 0) return [...workspaces];
  return workspaces.filter((workspace) => {
    // Whitespace-only names normalize away, so `size === 0` is exactly "carries no real label"
    // and the empty key can only ever mean Unlabelled.
    const keys = new Set((workspace.labels ?? []).map(workspaceLabelKey).filter(Boolean));
    const matches = (key: string) =>
      key === SIDEBAR_UNLABELLED_LABEL_KEY ? keys.size === 0 : keys.has(key);
    return labels.some(matches);
  });
}

interface LabelGroupNode {
  group: SidebarWorkspaceGroup;
  children: Map<string, LabelGroupNode>;
}

export function labelWorkspaceGroups(
  workspaces: readonly SidebarWorkspaceEntry[],
  unlabelled: string,
): SidebarWorkspaceGroup[] {
  const groups = new Map<string, LabelGroupNode>();
  for (const workspace of workspaces) {
    const paths = new Map<string, string[]>();
    for (const label of workspace.labels ?? []) {
      const segments = label.split("/").map(normalizeWorkspaceLabelName).filter(Boolean);
      const key = workspaceLabelKey(segments.join("/"));
      if (key && !paths.has(key)) paths.set(key, segments);
    }
    if (paths.size === 0) paths.set("", [unlabelled]);
    const keys = Array.from(paths.keys());
    for (const [key, segments] of paths) {
      // A workspace labelled both bb and bb/Billing belongs under Billing once.
      if (key && keys.some((candidate) => candidate.startsWith(`${key}/`))) continue;
      addLabelWorkspace({ groups, key, segments, workspace });
    }
  }
  return finishLabelGroups(groups);
}

function addLabelWorkspace(input: {
  groups: Map<string, LabelGroupNode>;
  key: string;
  segments: string[];
  workspace: SidebarWorkspaceEntry;
}): void {
  let level = input.groups;
  const path: string[] = [];
  for (const name of input.segments) {
    path.push(name);
    const key = input.key ? workspaceLabelKey(path.join("/")) : "";
    let node = level.get(key);
    if (!node) {
      node = {
        group: { key: `label:${key}`, label: name, rows: [], leading: { kind: "label" } },
        children: new Map(),
      };
      level.set(key, node);
    }
    if (path.length === input.segments.length) node.group.rows.push(input.workspace);
    level = node.children;
  }
}

function finishLabelGroups(groups: Map<string, LabelGroupNode>): SidebarWorkspaceGroup[] {
  return Array.from(groups.entries())
    .sort(([left], [right]) => {
      if (!left) return 1;
      if (!right) return -1;
      return left.localeCompare(right);
    })
    .map(([, node]) => {
      if (node.children.size > 0) node.group.children = finishLabelGroups(node.children);
      return node.group;
    });
}
