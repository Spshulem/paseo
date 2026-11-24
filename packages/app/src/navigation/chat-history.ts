import { create } from "zustand";

export interface ChatLocation {
  serverId: string;
  workspaceId: string;
  agentId: string;
}

interface ChatHistory {
  current: ChatLocation | null;
  previous: ChatLocation[];
  visit: (chat: ChatLocation) => void;
  back: (canOpen: (chat: ChatLocation) => boolean) => ChatLocation | undefined;
}

export function createChatHistory() {
  return create<ChatHistory>((set, get) => ({
    current: null,
    previous: [],
    visit: (chat) => {
      const { current, previous } = get();
      if (current?.serverId === chat.serverId && current.agentId === chat.agentId) {
        if (current.workspaceId !== chat.workspaceId) set({ current: chat });
        return;
      }
      set({ current: chat, previous: current ? [...previous, current].slice(-50) : previous });
    },
    back: (canOpen) => {
      const previous = [...get().previous];
      for (let chat = previous.pop(); chat; chat = previous.pop()) {
        if (!canOpen(chat)) continue;
        set({ current: chat, previous });
        return chat;
      }
      set({ previous });
      return undefined;
    },
  }));
}

export const useChatHistory = createChatHistory();
