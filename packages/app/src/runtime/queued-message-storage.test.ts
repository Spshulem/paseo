import { describe, expect, it } from "vitest";
import {
  readQueuedMessages,
  readPersistedQueuedMessageAttachments,
  writeQueuedMessages,
  type QueuedMessageStorage,
} from "./queued-message-storage";

function createStorage(): QueuedMessageStorage & {
  values: Map<string, string>;
  getAllKeys(): Promise<string[]>;
} {
  const values = new Map<string, string>();
  return {
    values,
    async getAllKeys() {
      return [...values.keys()];
    },
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

describe("queued message storage", () => {
  it("round-trips queues per server, including attachments", async () => {
    const storage = createStorage();
    const queues = new Map([
      [
        "agent-1",
        [
          {
            id: "message-1",
            queuedAt: 123,
            text: "Continue",
            attachments: [
              {
                kind: "workspace_file" as const,
                path: "src/index.ts",
                selection: { kind: "whole_file" as const },
              },
            ],
          },
        ],
      ],
    ]);

    await writeQueuedMessages(storage, "server-1", queues);
    await expect(readQueuedMessages(storage, "server-1")).resolves.toEqual(queues);
    await expect(readQueuedMessages(storage, "server-2")).resolves.toEqual(new Map());
    await expect(readPersistedQueuedMessageAttachments(storage)).resolves.toEqual(
      queues.get("agent-1")?.[0]?.attachments,
    );
  });

  it("removes malformed persisted queues instead of restoring unsafe data", async () => {
    const storage = createStorage();
    storage.values.set("queued-composer-messages:server-1", "{broken");

    await expect(readQueuedMessages(storage, "server-1")).resolves.toEqual(new Map());
    expect(storage.values.has("queued-composer-messages:server-1")).toBe(false);
  });

  it("removes a server queue after its last message is sent", async () => {
    const storage = createStorage();
    await writeQueuedMessages(
      storage,
      "server-1",
      new Map([["agent-1", [{ id: "m", text: "x", attachments: [] }]]]),
    );
    await writeQueuedMessages(storage, "server-1", new Map());

    expect(storage.values.has("queued-composer-messages:server-1")).toBe(false);
  });
});
