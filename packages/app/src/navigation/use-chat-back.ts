import { useCallback, useEffect } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useChatHistory } from "./chat-history";

export function useChatBack({
  serverId,
  workspaceId,
  agentId,
  isRouteFocused,
  isMobile,
  workspacePanelActive,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string | null;
  isRouteFocused: boolean;
  isMobile: boolean;
  workspacePanelActive: boolean;
}): (() => void) | undefined {
  const hasHistory = useChatHistory((history) => history.previous.length > 0);
  const isVisible = isRouteFocused && (!isMobile || workspacePanelActive);
  useEffect(() => {
    if (isVisible && serverId && workspaceId && agentId) {
      useChatHistory.getState().visit({ serverId, workspaceId, agentId });
    }
  }, [isVisible, serverId, workspaceId, agentId]);
  const goBack = useCallback(() => {
    const previous = useChatHistory.getState().back((chat) => {
      if (!getHostRuntimeStore().getSnapshot(chat.serverId)) return false;
      const session = useSessionStore.getState().sessions[chat.serverId];
      const agent = session?.agents.get(chat.agentId) ?? session?.agentDetails.get(chat.agentId);
      return !agent?.archivedAt;
    });
    if (previous) navigateToAgent({ ...previous, asTab: true });
  }, []);
  return agentId && hasHistory ? goBack : undefined;
}
