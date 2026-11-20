import { randomUUID } from "node:crypto"
import { showSystemNotification } from "@integrations/notifications"
import type { ClineAskQuestion } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { HostProvider } from "@/hosts/host-provider"
import { ClineClient } from "@/shared/cline"
import type { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import type { ToolResponse } from "../.."
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

export class AskFollowupQuestionMultiSelectToolHandler implements IToolHandler {
	readonly name = ClineDefaultTool.ASK_MULTI_SELECT

	getDescription(): string {
		return "Ask a follow-up question with multiple selections"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const host = await HostProvider.env.getHostVersion({})
		if (config.yoloModeToggled || host.clineType !== ClineClient.VSCode) {
			return formatResponse.toolError("Checkbox questions require an interactive VS Code session.")
		}

		const question = block.params.question?.trim()
		if (!question) {
			config.taskState.consecutiveMistakeCount++
			return config.callbacks.sayAndCreateMissingParamError(this.name, "question")
		}

		let options: string[]
		try {
			const parsed: unknown = JSON.parse(block.params.options ?? "null")
			if (
				!Array.isArray(parsed) ||
				parsed.length < 2 ||
				parsed.length > 5 ||
				!parsed.every((option) => typeof option === "string" && option.trim().length > 0)
			) {
				throw new Error("Invalid options")
			}
			options = parsed.map((option: string) => option.trim())
			if (new Set(options).size !== options.length) {
				throw new Error("Duplicate options")
			}
		} catch {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError("Provide two to five distinct, nonblank answer options as a JSON array.")
		}

		config.taskState.consecutiveMistakeCount = 0
		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({ subtitle: "Cline has a question...", message: question.replace(/\n/g, " ") })
		}

		const multiSelectId = randomUUID()
		const prompt: ClineAskQuestion = { question, options, multiSelectId }
		const { text } = await config.callbacks.ask("followup", JSON.stringify(prompt), false)
		if (!text) {
			return formatResponse.toolError("The checkbox question ended without a submitted answer.")
		}

		const { selected } = JSON.parse(text) as { selected: string[] }
		const messages = config.messageState.getClineMessages()
		const messageIndex = messages.findIndex((message) => message.ask === "followup" && message.text?.includes(multiSelectId))
		if (messageIndex !== -1) {
			await config.messageState.updateClineMessage(messageIndex, {
				text: JSON.stringify({ ...prompt, selectedOptions: selected }),
			})
		}
		return formatResponse.toolResult(text)
	}
}
