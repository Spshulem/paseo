import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProviderEventSchema } from "@getpaseo/plugin/server/provider";
import { readHistory } from "./history.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function fixture(text: string, filename = "transcript_full.jsonl") {
  const home = await mkdtemp(path.join(os.tmpdir(), "agy-history-"));
  homes.push(home);
  const directory = path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    "conversation",
    ".system_generated",
    "logs",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), text);
  return home;
}
function row(index: number, type: string, content: string, extra = {}) {
  return (
    JSON.stringify({
      step_index: index,
      type,
      content,
      status: "DONE",
      created_at: "2026-11-10T21:13:51Z",
      ...extra,
    }) + "\n"
  );
}

it("restores the original conversation across compaction and deduplicates streamed snapshots", async () => {
  const home = await fixture(
    row(
      0,
      "USER_INPUT",
      "<USER_REQUEST>Original request</USER_REQUEST><ADDITIONAL_METADATA>metadata</ADDITIONAL_METADATA>",
    ) +
      row(1, "PLANNER_RESPONSE", "partial", { status: "RUNNING" }) +
      row(1, "PLANNER_RESPONSE", "Full answer") +
      row(2, "CHECKPOINT", "summary") +
      row(3, "USER_INPUT", "Resume working") +
      row(4, "GENERIC", "original tool output") +
      '{"step_index":5',
  );
  const history = await readHistory(home, "conversation");
  expect(history.map(({ item }) => item.type)).toEqual([
    "user_message",
    "assistant_message",
    "compaction",
    "user_message",
    "tool_call",
  ]);
  expect(history[0]?.item).toMatchObject({ text: "Original request" });
  expect(history[1]?.item).toMatchObject({ text: "Full answer" });
  expect(new Set(history.map(({ item }) => item.id)).size).toBe(history.length);
  for (const entry of history)
    ProviderEventSchema.parse({ type: "timeline.item", sessionId: "s", ...entry });
});

it("reads the short transcript only when the full transcript is missing", async () => {
  const home = await fixture(row(0, "USER_INPUT", "older request"), "transcript.jsonl");
  expect((await readHistory(home, "conversation"))[0]?.item).toMatchObject({
    text: "older request",
  });
  expect(await readHistory(home, "new-conversation")).toEqual([]);
  await expect(readHistory(home, "../conversation")).rejects.toThrow(
    "Invalid Antigravity conversation ID",
  );
});

it("does not silently discard malformed earlier records", async () => {
  const home = await fixture("{bad}\n" + row(1, "USER_INPUT", "request"));
  await expect(readHistory(home, "conversation")).rejects.toThrow();
});

it("keeps tool requests and unassociated results valid without inventing a call/result link", async () => {
  const home = await fixture(
    row(0, "PLANNER_RESPONSE", "", {
      tool_calls: [{ name: "read_file", args: { Path: "/example.ts" } }],
    }) + row(1, "GENERIC", "file contents"),
  );
  const history = await readHistory(home, "conversation");
  expect(history).toHaveLength(2);
  for (const entry of history)
    ProviderEventSchema.parse({ type: "timeline.item", sessionId: "s", ...entry });
  expect(history[0]?.item).toMatchObject({
    name: "read_file",
    detail: { input: { Path: "/example.ts" }, output: null },
  });
  expect(history[1]?.item).toMatchObject({
    name: "Antigravity tool output",
    detail: { text: "file contents" },
  });
});
