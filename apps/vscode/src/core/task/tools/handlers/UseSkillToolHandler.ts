import type { ToolUse } from "@core/assistant-message"
import { discoverAvailableSkills, getSkillContent } from "@core/context/instructions/user-instructions/skills"
import { getTaskMetadata, saveTaskMetadata } from "@core/storage/disk"
import type { ActiveSkillMcpPolicy } from "@shared/mcpToolPolicy"
import { resolveMcpToolAvailability } from "@shared/mcpToolPolicy"
import { getSkillMcpToolDeclarations, type SkillMetadata } from "@shared/skills"
import { Logger } from "@/shared/services/Logger"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class UseSkillToolHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.USE_SKILL

	constructor() {}

	getDescription(block: ToolUse): string {
		const skillName = block.params.skill_name
		return skillName ? `[${block.name} for "${skillName}"]` : `[${block.name}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const skillName = block.params.skill_name
		if (uiHelpers.getConfig().isSubagentExecution) {
			return
		}
		const message = JSON.stringify({ tool: "useSkill", path: skillName || "" })
		await uiHelpers.say("tool", message, undefined, undefined, true)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const skillName: string | undefined = block.params.skill_name

		if (!skillName) {
			config.taskState.consecutiveMistakeCount++
			return `Error: Missing required parameter 'skill_name'. Please provide the name of the skill to activate.`
		}

		// A skill is already active for this task. Cline's own prompt tells the model not to
		// call use_skill again, but if it does anyway, reject rather than silently replacing
		// (or attempting to merge with) the already-active skill's MCP tool policy.
		if (config.taskState.activeSkillMcpPolicy) {
			return `Error: Skill "${config.taskState.activeSkillMcpPolicy.skillName}" is already active for this task. Only one skill may be active per task — continue using its instructions instead of activating another skill.`
		}

		// Discover skills on-demand (lazy loading)
		const remoteSkillEntries = config.services.stateManager.getRemoteConfigSettings().remoteGlobalSkills || []
		const stateManager = config.services.stateManager
		const availableSkills = await discoverAvailableSkills(config.cwd, {
			remoteSkillEntries,
			globalSkillsToggles: stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {},
			localSkillsToggles: stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {},
			remoteSkillsToggles: stateManager.getGlobalStateKey("remoteSkillsToggles") ?? {},
		})

		if (availableSkills.length === 0) {
			return `Error: No skills are available. Skills may be disabled or not configured.`
		}

		const globalCount = availableSkills.filter((skill) => skill.source === "global").length
		const projectCount = availableSkills.filter((skill) => skill.source === "project").length

		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider

		// Show tool message
		const message = JSON.stringify({ tool: "useSkill", path: skillName })
		if (!config.isSubagentExecution) {
			await config.callbacks.say("tool", message, undefined, undefined, false)
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			const skillContent = await getSkillContent(skillName, availableSkills, remoteSkillEntries)

			if (!skillContent) {
				const availableNames = availableSkills.map((s: SkillMetadata) => s.name).join(", ")
				return `Error: Skill "${skillName}" not found. Available skills: ${availableNames || "none"}`
			}

			telemetryService.safeCapture(
				() =>
					telemetryService.captureSkillUsed({
						ulid: config.ulid,
						skillName,
						skillSource: skillContent.source === "global" ? "global" : "project",
						skillsAvailableGlobal: globalCount,
						skillsAvailableProject: projectCount,
						provider,
						modelId: config.api.getModel().id,
					}),
				"UseSkillToolHandler.execute",
			)

			await this.snapshotActiveSkillMcpPolicy(config, skillContent)

			const skillDirNote = skillContent.path.startsWith("remote:")
				? ""
				: ` You may access other files in the skill directory at: ${skillContent.path.replace(/SKILL\.md$/, "")}`

			return `# Skill "${skillContent.name}" is now active

${skillContent.instructions}

---
IMPORTANT: The skill is now loaded. Do NOT call use_skill again for this task. Simply follow the instructions above to complete the user's request.${skillDirNote}`
		} catch (error) {
			return `Error loading skill "${skillName}": ${(error as Error)?.message}`
		}
	}

	/**
	 * Freezes the newly-activated skill's MCP tool policy on TaskState (reused for the rest of
	 * the task — see resolveEffectiveMcpTools) and persists a snapshot to task metadata so a
	 * resumed task can reconstruct + revalidate it later.
	 */
	private async snapshotActiveSkillMcpPolicy(
		config: TaskConfig,
		skillContent: { name: string; mcpTools?: SkillMetadata["mcpTools"] },
	): Promise<void> {
		const declarations = getSkillMcpToolDeclarations(skillContent)
		const policy: ActiveSkillMcpPolicy = {
			skillName: skillContent.name,
			allowed: declarations.allowed,
			disallowed: declarations.disallowed,
			allowedDeclared: declarations.allowedDeclared,
			disallowedDeclared: declarations.disallowedDeclared,
		}
		config.taskState.activeSkillMcpPolicy = policy

		const stateManager = config.services.stateManager
		const mode = stateManager.getGlobalSettingsKey("mode")
		const availability = resolveMcpToolAvailability(
			stateManager.getGlobalSettingsKey("planActSeparateModelsSetting"),
			stateManager.getGlobalSettingsKey("mcpToolAvailability"),
			mode,
			stateManager.getGlobalSettingsKey("planModeMcpToolAvailability"),
			stateManager.getGlobalSettingsKey("actModeMcpToolAvailability"),
		)
		if (availability === "dynamic_compatible" && !declarations.allowedDeclared && !declarations.disallowedDeclared) {
			Logger.warn(
				`Skill "${skillContent.name}" has no allowed_mcp_tools/disallowed_mcp_tools declarations; ` +
					`Dynamic (Compatible) mode is falling back to exposing all enabled MCP tools for this task.`,
			)
		}

		try {
			const metadata = await getTaskMetadata(config.taskId)
			metadata.active_skill_mcp_policy = policy
			await saveTaskMetadata(config.taskId, metadata)
		} catch (error) {
			Logger.warn(`Failed to persist active skill MCP policy for resume: ${(error as Error)?.message}`)
		}
	}
}
