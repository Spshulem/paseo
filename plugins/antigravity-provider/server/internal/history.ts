import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { ProviderTimelineItem } from "@getpaseo/plugin/server/provider";

const recordSchema = z.object({
  step_index: z.number().int().nonnegative(),
  type: z.string(),
  status: z.string(),
  created_at: z.string(),
  content: z.string().optional(),
  thinking: z.string().optional(),
  tool_calls: z
    .array(z.object({ name: z.string(), args: z.record(z.string(), z.json()) }))
    .optional(),
});

type Record = z.infer<typeof recordSchema>;
export interface HistoryItem {
  item: ProviderTimelineItem;
  timestamp: string;
}

// The CLI resumes model context but does not stream the earlier conversation.
// Its full transcript keeps snapshots across compactions; the short transcript does not.
export async function readHistory(home: string, conversationId: string): Promise<HistoryItem[]> {
  if (
    !conversationId ||
    path.basename(conversationId) !== conversationId ||
    conversationId === "." ||
    conversationId === ".."
  ) {
    throw new Error("Invalid Antigravity conversation ID");
  }
  const directory = path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    conversationId,
    ".system_generated",
    "logs",
  );
  for (const name of ["transcript_full.jsonl", "transcript.jsonl"]) {
    try {
      const records = await readRecords(path.join(directory, name));
      return records.flatMap((record) => projectRecord(conversationId, record));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [];
}

async function readRecords(file: string): Promise<Record[]> {
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const records = new Map<number, Record>();
  function accept(line: string, final: boolean): void {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      // A live CLI can be in the middle of appending its final snapshot.
      if (final && error instanceof SyntaxError) return;
      throw error;
    }
    const record = recordSchema.parse(value);
    records.set(record.step_index, record);
  }
  try {
    let pending: string | undefined;
    for await (const line of lines) {
      if (pending !== undefined) accept(pending, false);
      pending = line;
    }
    if (pending !== undefined) accept(pending, true);
  } finally {
    lines.close();
    input.destroy();
  }
  return [...records.values()].sort((a, b) => a.step_index - b.step_index);
}

function projectRecord(conversationId: string, record: Record): HistoryItem[] {
  const items: ProviderTimelineItem[] = [];
  const prefix = `antigravity:${conversationId}:${record.step_index}`;
  if (record.type === "USER_INPUT" && record.content) {
    const request = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(record.content);
    items.push({
      type: "user_message",
      id: `${prefix}:user`,
      text: request?.[1] ?? record.content,
    });
  } else if (record.type === "PLANNER_RESPONSE") {
    if (record.thinking)
      items.push({ type: "reasoning", id: `${prefix}:thinking`, text: record.thinking });
    if (record.content)
      items.push({ type: "assistant_message", id: `${prefix}:text`, text: record.content });
    for (const [index, tool] of (record.tool_calls ?? []).entries()) {
      const id = `${prefix}:tool:${index}`;
      const base = {
        type: "tool_call" as const,
        id,
        callId: id,
        name: tool.name,
        detail: { type: "unknown" as const, input: tool.args, output: null },
      };
      // A planner snapshot records a request, not the result of the tool. Keep the
      // result separately because this log format has no reliable call/result ID.
      items.push({ ...base, status: "completed", error: null });
    }
  } else if (record.type === "GENERIC" && record.content) {
    const id = `${prefix}:output`;
    const base = {
      type: "tool_call" as const,
      id,
      callId: id,
      name: "Antigravity tool output",
      detail: { type: "plain_text" as const, text: record.content },
    };
    items.push(
      record.status === "ERROR"
        ? { ...base, status: "failed", error: record.content }
        : { ...base, status: record.status === "DONE" ? "completed" : "running", error: null },
    );
  } else if (record.type === "CHECKPOINT") {
    items.push({ type: "compaction", id: `${prefix}:compaction`, status: "completed" });
  } else if (record.content) {
    items.push({
      type: "notification",
      id: `${prefix}:system`,
      level: record.status === "ERROR" ? "error" : "info",
      message: record.content,
    });
  }
  return items.map((item) => ({ item, timestamp: record.created_at }));
}
