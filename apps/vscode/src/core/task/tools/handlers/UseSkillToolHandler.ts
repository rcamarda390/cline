import type { ToolUse } from "@core/assistant-message"
import { discoverAvailableSkills, getSkillContent } from "@core/context/instructions/user-instructions/skills"
import { freezeSkillMcpPolicy, resolveMcpToolAvailability } from "@shared/mcpToolPolicy"
import { getSkillMcpToolDeclarations, type SkillMetadata } from "@shared/skills"
import { Logger } from "@/shared/services/Logger"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { persistSkillMcpPolicyState } from "../../skillMcpPolicy"
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
This skill is loaded. Follow its relevant instructions.
You may load another relevant skill when needed.
Avoid repeatedly loading the same skill unless its instructions are needed again.${skillDirNote}`
		} catch (error) {
			return `Error loading skill "${skillName}": ${(error as Error)?.message}`
		}
	}

	/**
	 * Adds the newly-loaded skill's frozen MCP tool policy to the task's loaded collection (see
	 * aggregateSkillMcpPolicies) and persists it for resume. Reloading an already-loaded skill is a
	 * no-op for policy: no duplicate entry, no reorder, no metadata write. The check-and-insert is
	 * synchronous, so concurrent activations cannot lose each other's entries.
	 */
	private async snapshotActiveSkillMcpPolicy(
		config: TaskConfig,
		skillContent: { name: string; mcpTools?: SkillMetadata["mcpTools"] },
	): Promise<void> {
		const policies = config.taskState.loadedSkillMcpPolicies
		if (policies.some((p) => p.skillName === skillContent.name)) {
			return
		}
		const declarations = getSkillMcpToolDeclarations(skillContent)
		policies.push(freezeSkillMcpPolicy(skillContent.name, declarations))

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
					`Dynamic (Compatible) mode exposes all enabled MCP tools unless another loaded skill declares them.`,
			)
		}

		await persistSkillMcpPolicyState(config.taskState, config.taskId)
	}
}
