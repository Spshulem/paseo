import { useFetchQueries } from "@/data/query";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePluginInstallations } from "@/plugins/registry";
import { useHosts } from "@/runtime/host-runtime";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { conversationSearchResponse, conversationSearchSection } from "./conversation-search-model";

function openAgent(serverId: string, agentId: string) {
  clearCommandCenterFocusRestoreElement();
  navigateToAgent({ serverId, agentId });
}

export function useConversationSearch(enabled: boolean, query: string, includeArchived: boolean) {
  const { t } = useTranslation();
  const plugins = usePluginInstallations("paseo-conversation-search");
  const hosts = useHosts();
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 250);
  const valid = trimmed.length > 0 && trimmed.length <= 300;
  const settled = trimmed === debounced;
  const queries = useFetchQueries(
    plugins.map((plugin) => ({
      dataShape: "value",
      staleTimeMs: 1000,
      queryKey: ["conversation-search", plugin.serverId, debounced, includeArchived],
      enabled: enabled && valid && settled,
      queryFn: async () =>
        conversationSearchResponse.parse(
          await plugin.invoke("conversations.search", {
            query: debounced,
            includeArchived,
          }),
        ),
      retry: false,
      refetchInterval: (current: { state: { data?: { indexing: boolean } } }) =>
        current.state.data?.indexing ? 1000 : 30000,
    })),
  );
  const sections =
    enabled && valid && settled
      ? plugins.flatMap((plugin, index) => {
          const response = queries[index].data;
          if (!response) return [];
          const label =
            hosts.find((host) => host.serverId === plugin.serverId)?.label ?? plugin.serverId;
          return [
            conversationSearchSection(
              plugin.serverId,
              label,
              response,
              t("agentList.badges.archived"),
              openAgent,
            ),
          ];
        })
      : [];
  const messages = enabled
    ? hosts.flatMap((host) => {
        const index = plugins.findIndex((plugin) => plugin.serverId === host.serverId);
        if (index < 0) return [`${host.label}: ${t("shell.commandCenter.deepUnavailable")}`];
        if (!valid || !settled) return [];
        const result = queries[index];
        const error = result.error?.message ?? result.data?.error;
        if (error) return [`${host.label}: ${error}`];
        if (!result.data) return [];
        return [
          `${host.label}: ${t(result.data.indexing ? "shell.commandCenter.deepIndexing" : "shell.commandCenter.deepCoverage", result.data)}`,
        ];
      })
    : [];
  if (enabled && trimmed.length > 300) messages.push(t("shell.commandCenter.deepTooLong"));
  return {
    sections,
    messages,
    loading: enabled && valid && (!settled || queries.some((result) => result.isFetching)),
    retry: () => {
      if (valid && settled) for (const result of queries) void result.refetch();
    },
    hasError:
      enabled && valid && settled && queries.some((result) => result.error || result.data?.error),
  };
}
