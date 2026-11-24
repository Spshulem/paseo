import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  addModelVisibleStructuredContent,
  serializePaseoToolInputParameters,
} from "./tools/paseo-tool-serialization.js";
import { createPaseoToolCatalog, type PaseoToolHostDependencies } from "./tools/paseo-tools.js";
import type { PaseoToolDefinition, PaseoToolResult } from "./tools/types.js";

export interface AgentMcpServerOptions extends PaseoToolHostDependencies {
  /**
   * Keep the initial MCP surface small for provider-launched sessions. The full
   * policy-filtered catalog remains callable through the discovery router.
   * Top-level MCP clients keep the historical direct-tool surface by default.
   */
  lazyToolLoading?: boolean;
}

type McpToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

function toMcpToolResult(result: PaseoToolResult): CallToolResult {
  const modelVisibleResult = addModelVisibleStructuredContent(result);
  return {
    content: modelVisibleResult.content as CallToolResult["content"],
    ...(modelVisibleResult.structuredContent !== undefined
      ? {
          structuredContent:
            modelVisibleResult.structuredContent as CallToolResult["structuredContent"],
        }
      : {}),
    ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
  };
}

const LAZY_SEARCH_LIMIT = 20;

function searchCatalogTools(
  tools: ReadonlyMap<string, PaseoToolDefinition>,
  query: string | undefined,
  limit: number,
): Array<{
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const terms = normalizedQuery.split(/\s+/u).filter(Boolean);
  const scored = [...tools.values()]
    .map((tool) => {
      const haystack = `${tool.name} ${tool.title ?? ""} ${tool.description}`.toLowerCase();
      if (terms.some((term) => !haystack.includes(term))) return null;
      let score = 0;
      if (normalizedQuery === tool.name) score += 100;
      if (tool.name.toLowerCase().startsWith(normalizedQuery)) score += 50;
      if (normalizedQuery && tool.description.toLowerCase().includes(normalizedQuery)) score += 10;
      return { tool, score };
    })
    .filter((entry): entry is { tool: PaseoToolDefinition; score: number } => entry !== null)
    .sort((left, right) =>
      normalizedQuery
        ? right.score - left.score || left.tool.name.localeCompare(right.tool.name)
        : 0,
    );

  return scored.slice(0, limit).map(({ tool }) => {
    const result: {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
    } = {
      name: tool.name,
      description: tool.description,
      inputSchema: serializePaseoToolInputParameters(tool),
    };
    if (tool.title) result.title = tool.title;
    return result;
  });
}

function registerLazyToolRouter(
  server: McpServer,
  catalog: Awaited<ReturnType<typeof createPaseoToolCatalog>>,
): void {
  server.registerTool(
    "paseo_tool_search",
    {
      title: "Discover Paseo tools",
      description:
        "Search the available Paseo tools without loading their full schemas into the model context. " +
        "Use the returned name and inputSchema with paseo_tool_call. An empty query lists the first tools.",
      inputSchema: {
        query: z.string().trim().optional().describe("Name or capability to search for."),
        limit: z
          .number()
          .int()
          .positive()
          .max(LAZY_SEARCH_LIMIT)
          .optional()
          .default(8)
          .describe(`Maximum results to return (1-${LAZY_SEARCH_LIMIT}).`),
      },
    },
    async ({ query, limit }: { query?: string; limit?: number }) =>
      toMcpToolResult({
        content: [],
        structuredContent: {
          tools: searchCatalogTools(catalog.tools, query, limit ?? 8),
        },
      }),
  );

  server.registerTool(
    "paseo_tool_call",
    {
      title: "Call a Paseo tool",
      description:
        "Call one of the policy-approved Paseo tools returned by paseo_tool_search. " +
        "Pass the exact tool name and an arguments object matching that tool's inputSchema.",
      inputSchema: {
        name: z.string().trim().min(1).describe("Exact Paseo tool name from paseo_tool_search."),
        arguments: z
          .record(z.string(), z.unknown())
          .optional()
          .default({})
          .describe("Arguments matching the selected tool's inputSchema."),
      },
    },
    async (
      { name, arguments: input }: { name: string; arguments?: Record<string, unknown> },
      context?: McpToolContext,
    ) => toMcpToolResult(await catalog.executeTool(name, input ?? {}, { signal: context?.signal })),
  );
}

export async function createAgentMcpServer(options: AgentMcpServerOptions): Promise<McpServer> {
  const catalog = await createPaseoToolCatalog(options);
  const server = new McpServer({
    name: "agent-mcp",
    version: "2.0.0",
  });

  if (options.lazyToolLoading) {
    registerLazyToolRouter(server, catalog);
    return server;
  }

  for (const tool of catalog.tools.values()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown, context?: McpToolContext) =>
        toMcpToolResult(await catalog.executeTool(tool.name, args, { signal: context?.signal })),
    );
  }

  return server;
}
