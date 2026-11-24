import { describe, expect, it } from "vitest";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { buildProviderHandoff } from "./provider-handoff.js";

function row(seq: number, item: AgentTimelineRow["item"]): AgentTimelineRow {
  return { seq, item, timestamp: "2026-11-19T00:00:00Z" };
}

describe("provider handoff", () => {
  const rows = [
    row(1, { type: "user_message", text: "original request" }),
    row(2, { type: "assistant_message", text: "work completed elsewhere" }),
    row(3, { type: "reasoning", text: "private reasoning" }),
  ];

  it("sends only missed conversation on switch back", () => {
    expect(
      buildProviderHandoff({ epoch: "live", rows, checkpoint: { epoch: "live", seq: 1 } }),
    ).toEqual({
      context: JSON.stringify({ role: "assistant", text: "work completed elsewhere" }),
      through: { epoch: "live", seq: 3 },
    });
  });

  it("does not skip messages when the timeline was rebuilt", () => {
    const result = buildProviderHandoff({
      epoch: "new",
      rows,
      checkpoint: { epoch: "old", seq: 3 },
    });
    expect(result.context?.split("\n").map((line) => JSON.parse(line))).toEqual([
      { role: "user", text: "original request" },
      { role: "assistant", text: "work completed elsewhere" },
    ]);
  });

  it("bounds UTF-8 output and retains the latest user request", () => {
    const result = buildProviderHandoff({
      epoch: "live",
      rows: [
        ...Array.from({ length: 12 }, (_, i) =>
          row(i + 1, { type: "assistant_message", text: "\u{1F680}".repeat(2_000) }),
        ),
        row(13, { type: "user_message", text: "latest request" }),
      ],
    });
    expect(Buffer.byteLength(result.context ?? "")).toBeLessThanOrEqual(16_384);
    expect(result.context).toContain("[Earlier text omitted]");
    expect(result.context).not.toContain("\uFFFD");
    expect(result.context?.endsWith('{"role":"user","text":"latest request"}')).toBe(true);
  });

  it("does not drop the latest message when JSON escaping expands it", () => {
    const result = buildProviderHandoff({
      epoch: "live",
      rows: [row(1, { type: "user_message", text: "\u0001".repeat(4_096) + "keep this" })],
    });
    expect(result.context).toContain("keep this");
    expect(Buffer.byteLength(result.context ?? "")).toBeLessThan(4_200);
  });
});
