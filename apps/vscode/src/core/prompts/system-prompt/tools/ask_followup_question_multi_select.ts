import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

export const askFollowupQuestionMultiSelect: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.ASK_MULTI_SELECT,
	name: ClineDefaultTool.ASK_MULTI_SELECT,
	description:
		"Ask one follow-up question when several choices can apply. The user checks one or more options and submits them together. Use ask_followup_question for single-choice or free-text questions.",
	contextRequirements: (context) => context.supportsMultiSelectQuestions === true && !context.yoloModeToggled,
	parameters: [
		{
			name: "question",
			required: true,
			instruction: "One clear question that invites the user to select all applicable options.",
			usage: "Which checks should I run?",
		},
		{
			name: "options",
			required: true,
			instruction: "A JSON-encoded array of two to five distinct, nonblank answer labels. The user must select at least one.",
			usage: '["Unit tests", "Integration tests", "Lint"]',
		},
	],
}
