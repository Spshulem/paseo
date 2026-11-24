import { useLocalSearchParams } from "expo-router";
import { useNavigation, type NavigationProp } from "expo-router/react-navigation";
import { useCallback, useMemo, useState } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import {
  ComposerEditingScope,
  WorkspaceComposerEditingSessionsProvider,
} from "@/composer/editing-session";
import { NewWorkspaceScreen, type NewWorkspacePlacement } from "@/screens/new-workspace-screen";
import { buildNewWorkspaceDraftKey } from "@/stores/draft-keys";

/** New workspace drafts share one editing-session home, keyed like a tab by draft. */
const NEW_WORKSPACE_SESSIONS_KEY = "new-workspace";

type NewWorkspaceRouteParams = Partial<
  Record<"serverId" | "dir" | "name" | "projectId" | "draftId", string>
>;

function placementKey(placement: NewWorkspacePlacement, draftId: string | undefined): string {
  return JSON.stringify([
    draftId ?? null,
    placement.serverId,
    placement.sourceDirectory ?? null,
    placement.displayName ?? null,
    placement.projectId ?? null,
  ]);
}

export default function NewWorkspaceRoute() {
  const navigation = useNavigation<NavigationProp<{ new: NewWorkspaceRouteParams }, "new">>();
  const params = useLocalSearchParams<NewWorkspaceRouteParams>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const sourceDirectory = typeof params.dir === "string" ? params.dir : undefined;
  const displayName = typeof params.name === "string" ? params.name : undefined;
  const projectId = typeof params.projectId === "string" ? params.projectId : undefined;
  const draftId = typeof params.draftId === "string" ? params.draftId : undefined;
  const routePlacementKey = placementKey(
    { serverId, sourceDirectory, displayName, projectId },
    draftId,
  );
  const [routeIdentity, setRouteIdentity] = useState({
    placementKey: routePlacementKey,
    publishedPlacementKey: null as string | null,
    generation: 0,
    context: { serverId, sourceDirectory, displayName, projectId },
  });
  if (routeIdentity.placementKey !== routePlacementKey) {
    // The screen mirrors its own placement into the URL so a reload restores it; that mirror keeps
    // the mounted draft and its original context. Any other navigation starts a new selection.
    const isPlacementMirror = routeIdentity.publishedPlacementKey === routePlacementKey;
    setRouteIdentity({
      placementKey: routePlacementKey,
      publishedPlacementKey: null,
      generation: routeIdentity.generation + (isPlacementMirror ? 0 : 1),
      context: isPlacementMirror
        ? routeIdentity.context
        : { serverId, sourceDirectory, displayName, projectId },
    });
  }
  const handlePlacementChange = useCallback(
    (placement: NewWorkspacePlacement) => {
      const nextPlacementKey = placementKey(placement, draftId);
      if (nextPlacementKey === routePlacementKey) return;
      setRouteIdentity((current) => ({ ...current, publishedPlacementKey: nextPlacementKey }));
      // The matched route's navigation, so a late update cannot rewrite another route's params.
      navigation.setParams({
        serverId: placement.serverId,
        dir: placement.sourceDirectory,
        name: placement.displayName,
        projectId: placement.projectId,
      });
    },
    [draftId, navigation, routePlacementKey],
  );

  // The shell remounts this route when the viewport crosses the compact breakpoint;
  // the draft's editing session (fullscreen, retained caret) lives above the shell.
  const draftKey = buildNewWorkspaceDraftKey(draftId);
  const sessionTabIds = useMemo(() => [draftKey], [draftKey]);

  return (
    <HostRouteBootstrapBoundary>
      <WorkspaceComposerEditingSessionsProvider
        workspaceKey={NEW_WORKSPACE_SESSIONS_KEY}
        tabIds={sessionTabIds}
      >
        <ComposerEditingScope tabId={draftKey} targetKey={draftKey}>
          <NewWorkspaceScreen
            key={`${draftKey}:${routeIdentity.generation}`}
            serverId={routeIdentity.context.serverId}
            sourceDirectory={routeIdentity.context.sourceDirectory}
            displayName={routeIdentity.context.displayName}
            projectId={routeIdentity.context.projectId}
            draftId={draftId}
            onPlacementChange={handlePlacementChange}
          />
        </ComposerEditingScope>
      </WorkspaceComposerEditingSessionsProvider>
    </HostRouteBootstrapBoundary>
  );
}
