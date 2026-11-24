import type { Agent, SessionState } from "@/stores/session-store";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

export interface RecentConversation {
  key: string;
  serverId: string;
  workspaceId: string;
  agentId: string;
  title: string | null;
  projectName: string;
  workspaceName: string;
  sentAt: number;
}

export type RecentAgent = Pick<
  Agent,
  "id" | "title" | "workspaceId" | "archivedAt" | "background" | "lastUserMessageAt"
>;
interface RecentSession {
  agents: ReadonlyMap<string, RecentAgent>;
  queuedMessages: SessionState["queuedMessages"];
}

function lastSentAt(agent: RecentAgent, queue: RecentSession["queuedMessages"]): number {
  const timestamp = agent.lastUserMessageAt?.getTime() ?? 0;
  let sentAt = Number.isFinite(timestamp) ? timestamp : 0;
  // A queued message is already a user action, even before the provider receives it.
  for (const message of queue.get(agent.id) ?? []) {
    if (message.queuedAt && Number.isFinite(message.queuedAt)) {
      sentAt = Math.max(sentAt, message.queuedAt);
    }
  }
  return sentAt;
}

/** Keep streaming updates out of the selector's scan and out of the rendered list. */
export function createRecentConversationsSelector() {
  let previousWorkspaces: ReadonlyMap<string, SidebarWorkspaceEntry> | undefined;
  let previousSources: {
    serverId: string;
    agents: RecentSession["agents"];
    queue: RecentSession["queuedMessages"];
  }[] = [];
  let previous: RecentConversation[] = [];
  return (
    sessions: Readonly<Record<string, RecentSession | undefined>>,
    workspaces: ReadonlyMap<string, SidebarWorkspaceEntry>,
  ): RecentConversation[] => {
    const sources = Object.entries(sessions).flatMap(([serverId, session]) =>
      session ? [{ serverId, agents: session.agents, queue: session.queuedMessages }] : [],
    );
    if (
      previousWorkspaces === workspaces &&
      sources.length === previousSources.length &&
      sources.every((source, index) => {
        const last = previousSources[index];
        return (
          source.serverId === last.serverId &&
          source.agents === last.agents &&
          source.queue === last.queue
        );
      })
    )
      return previous;
    previousSources = sources;
    previousWorkspaces = workspaces;

    const rows: RecentConversation[] = [];
    for (const { serverId, agents, queue } of sources) {
      for (const agent of agents.values()) {
        if (!agent.workspaceId || agent.archivedAt || agent.background) continue;
        const workspace = workspaces.get(`${serverId}:${agent.workspaceId}`);
        if (!workspace || workspace.archivingAt) continue;
        const sentAt = lastSentAt(agent, queue);
        if (sentAt <= 0) continue;
        rows.push({
          key: `${serverId}:${agent.id}`,
          serverId,
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          title: agent.title?.trim() || null,
          projectName: workspace.projectName,
          workspaceName: workspace.name,
          sentAt,
        });
      }
    }
    rows.sort((a, b) => b.sentAt - a.sentAt || a.key.localeCompare(b.key));
    const next = rows.slice(0, 20);
    if (
      next.length === previous.length &&
      next.every((row, index) => {
        const last = previous[index];
        return (
          row.key === last.key &&
          row.sentAt === last.sentAt &&
          row.title === last.title &&
          row.workspaceId === last.workspaceId &&
          row.projectName === last.projectName &&
          row.workspaceName === last.workspaceName
        );
      })
    )
      return previous;
    previous = next;
    return next;
  };
}
