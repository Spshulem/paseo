import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createIdleAgent, createMockIdleAgent } from "../support/helpers/archive-tab";
import { expectAgentTabActive } from "../support/helpers/launcher";
import { openCommandCenter } from "../support/helpers/command-center";
import { addOfflineHostAndReload } from "../support/helpers/hosts";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { seedRunningMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { copyPluginExample, pluginRequirements } from "../support/helpers/plugin-fixture";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";

const PRIMARY_HOST_LABEL = "Primary Host";
const SECONDARY_HOST_ID = "host-command-center-workspaces-secondary";
const WORKSPACE_TITLE = "Payments Refactor";
const WORKSPACE_BRANCH = "feature/cmd-k-workspaces";
const AGENT_TITLE = "Fix checkout retries";

test.describe("Command center workspaces", () => {
  test.describe.configure({ timeout: 180_000 });

  test("agent and workspace results retain their icons and overlay live status", async ({
    page,
  }) => {
    const workspace = await seedRunningMockAgentWorkspace({
      repoPrefix: "command-center-status-",
      title: "Review checkout retries",
      model: "five-minute-stream",
      initialPrompt: "Keep working on checkout retries",
    });
    try {
      await openAgentRoute(page, workspace);
      await expectAgentTabActive(page, workspace.agentId);
      const panel = await openCommandCenter(page);
      const agent = panel.getByTestId(`command-center-agent-${getServerId()}:${workspace.agentId}`);
      const row = panel.getByTestId(
        `command-center-workspace-${getServerId()}:${workspace.workspaceId}`,
      );
      await expect(agent.getByRole("progressbar", { name: "Agent running" })).toBeVisible();
      await expect(row.getByRole("progressbar", { name: "Agent running" })).toBeVisible();
      await expect(agent.getByRole("img", { name: "Mock agent" })).toBeVisible();
      await workspace.client.cancelAgent(workspace.agentId);
      await expect(agent.getByRole("progressbar")).toHaveCount(0);
      await expect(row.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace results show their title, host, and branch and open the workspace", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({
      repoPrefix: "command-center-workspace-",
      title: WORKSPACE_TITLE,
    });

    try {
      execFileSync("git", ["checkout", "-b", WORKSPACE_BRANCH], {
        cwd: seeded.repoPath,
        stdio: "ignore",
      });
      const refreshed = await seeded.client.checkoutRefresh(seeded.repoPath);
      if (!refreshed.success) {
        throw new Error(`Failed to refresh checkout: ${JSON.stringify(refreshed.error)}`);
      }
      const agent = await createIdleAgent(seeded.client, {
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title: AGENT_TITLE,
      });

      await gotoAppShell(page);
      await addOfflineHostAndReload(page, {
        serverId: SECONDARY_HOST_ID,
        label: "Secondary Host",
        primaryLabel: PRIMARY_HOST_LABEL,
      });

      const panel = await openCommandCenter(page);
      const row = panel.getByTestId(
        `command-center-workspace-${getServerId()}:${seeded.workspaceId}`,
      );
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toContainText(WORKSPACE_TITLE);
      await expect(row).toContainText(WORKSPACE_BRANCH);

      // The subtitle disambiguates by project: host · project · branch (multi-host).
      const subtitle = row.getByTestId("command-center-workspace-subtitle");
      await expect(subtitle).toContainText(PRIMARY_HOST_LABEL);
      await expect(subtitle).toContainText(seeded.projectDisplayName);
      await expect(subtitle).toContainText(WORKSPACE_BRANCH);

      // The agent subtitle is unchanged by the shared-helper refactor.
      const agentRow = panel.getByTestId(`command-center-agent-${getServerId()}:${agent.id}`);
      await expect(agentRow).toContainText(AGENT_TITLE);
      await expect(agentRow).toContainText(PRIMARY_HOST_LABEL);
      await expect(agentRow).toContainText(WORKSPACE_TITLE);
      await expect(agentRow).not.toContainText(seeded.repoPath);

      const workspaceSectionTop = await panel
        .getByText("Workspaces", { exact: true })
        .evaluate((element) => element.getBoundingClientRect().top);
      const agentSectionTop = await panel
        .getByText("Agents", { exact: true })
        .evaluate((element) => element.getBoundingClientRect().top);
      expect(workspaceSectionTop).toBeLessThan(agentSectionTop);

      const input = panel.getByTestId("command-center-input");
      await input.fill(PRIMARY_HOST_LABEL);
      await expect(row).toBeVisible();
      await expect(agentRow).toBeVisible();

      await input.fill(WORKSPACE_BRANCH);
      await expect(row).toBeVisible();
      await expect(agentRow).not.toBeVisible();

      await input.fill(WORKSPACE_TITLE);
      await expect(row).toBeVisible();
      await expect(agentRow).toBeVisible();

      await input.fill(seeded.repoPath);
      await expect(agentRow).toBeVisible();
      await expect(row).not.toBeVisible();

      // The project name is now part of the workspace searchText.
      await input.fill(seeded.projectDisplayName);
      await expect(row).toBeVisible();

      await input.fill(AGENT_TITLE);
      await expect(agentRow).toBeVisible();
      await expect(row).not.toBeVisible();

      await input.fill(WORKSPACE_TITLE);
      await page.keyboard.press("Enter");

      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), seeded.workspaceId), {
        timeout: 30_000,
      });

      await test.step("find an agent and open its workspace tab", async () => {
        const agentPanel = await openCommandCenter(page);
        await agentPanel.getByTestId("command-center-input").fill(AGENT_TITLE);
        await page.keyboard.press("Enter");
        await expectAgentTabActive(page, agent.id);
      });
    } finally {
      await seeded.cleanup();
    }
  });

  test("single-host workspace subtitle omits the host and shows project · branch", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({
      repoPrefix: "command-center-workspace-single-",
      title: WORKSPACE_TITLE,
    });

    try {
      execFileSync("git", ["checkout", "-b", WORKSPACE_BRANCH], {
        cwd: seeded.repoPath,
        stdio: "ignore",
      });
      const refreshed = await seeded.client.checkoutRefresh(seeded.repoPath);
      if (!refreshed.success) {
        throw new Error(`Failed to refresh checkout: ${JSON.stringify(refreshed.error)}`);
      }

      // No secondary host: with a single host, the host label is gated away.
      await gotoAppShell(page);

      const panel = await openCommandCenter(page);
      const row = panel.getByTestId(
        `command-center-workspace-${getServerId()}:${seeded.workspaceId}`,
      );
      await expect(row).toBeVisible({ timeout: 30_000 });

      const subtitle = row.getByTestId("command-center-workspace-subtitle");
      await expect(subtitle).toHaveText(`${seeded.projectDisplayName} · ${WORKSPACE_BRANCH}`);
    } finally {
      await seeded.cleanup();
    }
  });
});

test.describe("Compact sidebar inspection", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function openSidebar(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(page.getByTestId("sidebar-search")).toBeVisible();
  }

  async function expectSidebarPreserved(page: import("@playwright/test").Page) {
    await expect(page.getByRole("button", { name: "Close menu", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByTestId("sidebar-search")).toBeVisible();
  }

  test("canceling Search retains the compact sidebar", async ({ page }) => {
    await gotoAppShell(page);
    await openSidebar(page);
    await openCommandCenter(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-center-panel")).not.toBeVisible();
    await expectSidebarPreserved(page);
  });
  test("canceling Import session retains the compact sidebar", async ({ page }) => {
    await gotoAppShell(page);
    await openSidebar(page);
    await page
      .getByTestId("sidebar-project-empty-state")
      .getByRole("button", { name: "Import session", exact: true })
      .click();
    await expect(page.getByTestId("import-session-sheet")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("import-session-sheet")).not.toBeVisible();
    await expectSidebarPreserved(page);
  });

  test("Search reveals the same workspace and a selected root agent", async ({ page }) => {
    const seeded = await seedWorkspace({
      repoPrefix: "compact-search-destination-",
      title: "Compact destination",
    });
    try {
      const agent = await createIdleAgent(seeded.client, {
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title: "Compact root agent",
      });
      await page.goto(buildHostWorkspaceRoute(getServerId(), seeded.workspaceId));
      await openSidebar(page);
      const search = await openCommandCenter(page);
      await search.getByTestId("command-center-input").fill("Compact destination");
      await search
        .getByTestId(`command-center-workspace-${getServerId()}:${seeded.workspaceId}`)
        .click();
      await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeVisible();
      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), seeded.workspaceId));
      await openSidebar(page);
      const agentSearch = await openCommandCenter(page);
      await agentSearch.getByTestId("command-center-input").fill("Compact root agent");
      await agentSearch.getByTestId(`command-center-agent-${getServerId()}:${agent.id}`).click();
      await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Message agent...", exact: true }),
      ).toBeVisible();
    } finally {
      await seeded.cleanup();
    }
  });
});

test("Quick and Deep share search while Auto-resume lives in settings", async ({ page }) => {
  test.setTimeout(180_000);
  const seeded = await seedWorkspace({
    repoPrefix: "unified-search-",
    title: "Search integration",
  });
  const searchDirectory = await mkdtemp(join(tmpdir(), "paseo-deep-search-"));
  const resume = await copyPluginExample("auto-resume");
  const pluginClient = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previous = await pluginClient.getDaemonConfig();
  let searchInstalled = false;
  let resumeInstalled = false;
  try {
    const agent = await createMockIdleAgent(seeded.client, {
      cwd: seeded.repoPath,
      workspaceId: seeded.workspaceId,
      title: "Search target",
    });
    await writeFile(
      join(searchDirectory, "paseo-plugin.json"),
      JSON.stringify({ id: "paseo-conversation-search", requirements: pluginRequirements }),
    );
    await writeFile(
      join(searchDirectory, "index.client.tsx"),
      "export default function contribute() { return () => {}; }",
    );
    await writeFile(
      join(searchDirectory, "index.server.ts"),
      `import { defineRpc } from "@getpaseo/plugin"; import { z } from "zod";
export default function contribute(server) {
  server.handle(defineRpc({name:"conversations.search",input:z.object({query:z.string()}),output:z.unknown()}), ({query}) => {
    if (query === "broken") throw new Error("Search host disconnected");
    return {results:query === "message-needle" ? [{agentId:${JSON.stringify(agent.id)},title:"Search target",provider:"codex",archived:false,snippet:"message-needle from recent messages",score:1}] : [],total:1,indexed:1,unavailable:0,indexing:false,error:null};
  }); return () => {};
}`,
    );
    await writeFile(
      join(resume.directory, "index.server.ts"),
      `import {status,enable,cancel} from "./shared/contracts";
export default function contribute(server) {
  let enabled=true; let fail=true;
  server.handle(status,()=>({enabled,error:"Could not publish retry notice",retries:[]}));
  server.handle(enable,(input)=>{if(fail){fail=false;throw new Error("Could not save. Try again.");} enabled=input.enabled;return {};});
  server.handle(cancel,()=>({})); return () => {};
}`,
    );
    await pluginClient.patchDaemonConfig({ pluginsEnabled: true });
    await pluginClient.installDirectoryPlugin(searchDirectory);
    searchInstalled = true;
    await pluginClient.installDirectoryPlugin(resume.directory);
    resumeInstalled = true;
    await gotoAppShell(page);
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 844 });
      if (width === 390) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const panel = await openCommandCenter(page);
      const input = panel.getByTestId("command-center-input");
      await input.fill("message-needle");
      await expect(panel.getByText("Search target", { exact: true })).toHaveCount(0);
      await panel.getByTestId("command-center-mode-deep").click();
      await expect(input).toHaveValue("message-needle");
      await expect(panel.getByText("Search target", { exact: true })).toBeVisible();
      await expect(
        panel.getByText("codex · message-needle from recent messages", { exact: true }),
      ).toBeVisible();
      await panel.getByTestId("command-center-mode-quick").click();
      await expect(input).toHaveValue("message-needle");
      await expect(panel.getByText("Search target", { exact: true })).toHaveCount(0);
      await panel.getByTestId("command-center-mode-deep").click();
      await input.fill("broken");
      await expect(panel.getByText(/Search host disconnected/)).toBeVisible();
      await expect(panel.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      await input.fill("message-needle");
      await expect(panel.getByText("Search target", { exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`search-${width}.png`) });
      await panel.getByText("Search target", { exact: true }).click();
      await expect(panel).not.toBeVisible();
      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), seeded.workspaceId));
      await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible();
      // Compact layout replaces the tab strip with a picker; widening exposes the selected tab.
      if (width === 390) await page.setViewportSize({ width: 1200, height: 844 });
      await expectAgentTabActive(page, agent.id);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/settings/hosts/${getServerId()}/plugins/auto-resume/auto-resume`);
    const toggle = page.getByRole("switch", { name: "Resume after temporary limits", exact: true });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(page.getByText(/Could not save\. Try again\./)).toBeVisible();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(/Could not save\. Try again\./)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("auto-resume-settings.png") });
  } finally {
    if (searchInstalled) await pluginClient.removePlugin("paseo-conversation-search");
    if (resumeInstalled) await pluginClient.removePlugin("auto-resume");
    await pluginClient.patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled });
    await pluginClient.close();
    await resume.cleanup();
    await rm(searchDirectory, { recursive: true, force: true });
    await seeded.cleanup();
  }
});
