import { describe, expect, it } from "vitest";
import { createChatHistory } from "./chat-history";

describe("chat back navigation", () => {
  const first = { serverId: "mac", workspaceId: "one", agentId: "a" };
  const second = { serverId: "build", workspaceId: "two", agentId: "a" };
  const third = { ...second, agentId: "c" };

  it("goes back across hosts and tabs without adding the return trip to history", () => {
    const { visit, back } = createChatHistory().getState();
    visit(first);
    visit(second);
    visit(second);
    visit(third);
    expect(back(() => true)).toEqual(second);
    visit(second);
    expect(back(() => true)).toEqual(first);
    expect(back(() => true)).toBeUndefined();
  });

  it("skips entries for chats that are no longer available", () => {
    const { visit, back } = createChatHistory().getState();
    visit(first);
    visit(second);
    visit(third);
    expect(back((chat) => chat !== second)).toEqual(first);
    expect(back(() => true)).toBeUndefined();
  });
});
