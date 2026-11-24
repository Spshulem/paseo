import { z } from "zod";
import { PINNED_SECTION_BAND, type CommandCenterResultSection } from "./results";

// The private conversation-search plugin owns this RPC; validate its response at the app boundary.
export const conversationSearchResponse = z.object({
  results: z.array(
    z.object({
      agentId: z.string(),
      title: z.string(),
      provider: z.string(),
      archived: z.boolean(),
      snippet: z.string(),
      score: z.number(),
    }),
  ),
  total: z.number(),
  indexed: z.number(),
  unavailable: z.number(),
  indexing: z.boolean(),
  error: z.string().nullable(),
});

export function conversationSearchSection(
  serverId: string,
  hostLabel: string,
  response: z.infer<typeof conversationSearchResponse>,
  archivedLabel: string,
  openAgent: (serverId: string, agentId: string) => void,
): CommandCenterResultSection {
  return {
    id: `conversations:${serverId}`,
    band: PINNED_SECTION_BAND,
    rank: 0,
    title: hostLabel,
    results: response.results.map((entry, rank) => {
      const id = `conversation:${serverId}:${entry.agentId}`;
      const run = () => openAgent(serverId, entry.agentId);
      return {
        kind: "contribution",
        id,
        run,
        contribution: {
          id,
          group: serverId,
          groupRank: 0,
          rank,
          keywords: [],
          visibility: "always",
          run,
          presentation: {
            kind: "action",
            title: entry.title,
            subtitle: [entry.provider, entry.archived ? archivedLabel : "", entry.snippet]
              .filter(Boolean)
              .join(" · "),
          },
        },
      };
    }),
  };
}
