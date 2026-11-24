import { useCallback, useMemo, useState } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { MessageCircle } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { DensityIcon } from "@/components/ui/density-icon";
import { PressHighlight } from "@/components/ui/press-highlight";
import { density, densityIconBox } from "@/styles/density";
import { useSidebarModel } from "./sidebar-model";
import { SidebarSectionHeader } from "./sidebar-section-header";
import { SidebarGroupToggleRow } from "./sidebar-group-toggle-row";
import { createRecentConversationsSelector, type RecentConversation } from "./sidebar-recents";

const RECENTS_SECTION_KEY = "sidebar:recents";

export function SidebarRecentsSection({ onChatPress }: { onChatPress?: () => void }) {
  const { t } = useTranslation();
  const { workspaceEntriesByKey } = useSidebarModel();
  const selectRecents = useMemo(createRecentConversationsSelector, []);
  const select = useCallback(
    (state: ReturnType<typeof useSessionStore.getState>) =>
      selectRecents(state.sessions, workspaceEntriesByKey),
    [selectRecents, workspaceEntriesByKey],
  );
  const recents = useSessionStore(select);
  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    state.collapsedWorkspaceGroupKeys.has(RECENTS_SECTION_KEY),
  );
  const toggle = useSidebarCollapsedSectionsStore((state) => state.toggleWorkspaceGroupCollapsed);
  const [showAll, setShowAll] = useState(false);
  const toggleCollapsed = useCallback(() => toggle(RECENTS_SECTION_KEY), [toggle]);
  const toggleShowAll = useCallback(() => setShowAll((value) => !value), []);

  return (
    <View style={styles.section} testID="sidebar-recents-section">
      <SidebarSectionHeader
        title={t("sidebar.recents.title")}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        testID="sidebar-recents-section-header"
      />
      {collapsed ? null : (
        <>
          {(showAll ? recents : recents.slice(0, 5)).map((chat) => (
            <RecentConversationRow key={chat.key} chat={chat} onChatPress={onChatPress} />
          ))}
          {recents.length === 0 ? (
            <Text style={styles.empty}>{t("sidebar.recents.empty")}</Text>
          ) : null}
          {recents.length > 5 ? (
            <SidebarGroupToggleRow
              expanded={showAll}
              onPress={toggleShowAll}
              testID="sidebar-recents-show-more"
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function RecentConversationRow({
  chat,
  onChatPress,
}: {
  chat: RecentConversation;
  onChatPress?: () => void;
}) {
  const { t } = useTranslation();
  const title = chat.title ?? t("sidebar.recents.untitled");
  const openChat = useCallback(() => {
    navigateToWorkspace({
      serverId: chat.serverId,
      workspaceId: chat.workspaceId,
      target: { kind: "agent", agentId: chat.agentId },
    });
    onChatPress?.();
  }, [chat.serverId, chat.workspaceId, chat.agentId, onChatPress]);
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${chat.projectName}, ${chat.workspaceName}`}
      testID={`sidebar-recent-chat-${chat.key}`}
      onPress={openChat}
      style={recentRowStyle}
    >
      <View style={styles.icon}>
        <DensityIcon icon={MessageCircle} size="sm" color="foregroundMuted" />
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.context} numberOfLines={1}>
          {chat.projectName} · {chat.workspaceName}
        </Text>
      </View>
    </PressHighlight>
  );
}

function recentRowStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, hovered && styles.hovered, pressed && styles.pressed];
}

const styles = StyleSheet.create((theme) => ({
  section: { marginBottom: theme.spacing[2] },
  row: {
    minHeight: density.rowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    marginBottom: theme.spacing[0.5],
    borderRadius: theme.borderRadius.lg,
  },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  pressed: { backgroundColor: theme.colors.surface2 },
  icon: { width: densityIconBox("md"), alignItems: "center" },
  content: { flex: 1, minWidth: 0, gap: theme.spacing[0.5] },
  title: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  context: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  empty: {
    padding: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
