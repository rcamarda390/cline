import { type PromptVariant, type SystemPromptContext, SystemPromptSection, TemplateEngine } from ".."

const FOCUS_CHAIN = `FOCUS CHAIN

For tasks that involve multiple steps, maintain a todo list so you and the user can track progress and stay focused on the objective. This matters most on longer or complex tasks, where it's easy to lose track of what's done and what remains.

- Use the task_progress parameter (see 'Updating Task Progress') to create and update this list - it is not a separate tool call.
- Simple, single-step tasks do not need a todo list.
- The system will periodically remind you to create or update the list; treat these reminders as important.`

export async function getTodoSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	if (!context.focusChainSettings?.enabled) {
		return undefined
	}

	// Check for component override first
	if (variant.componentOverrides?.[SystemPromptSection.TODO]?.template) {
		const template = variant.componentOverrides[SystemPromptSection.TODO].template
		return new TemplateEngine().resolve(template, context, {})
	}

	return new TemplateEngine().resolve(FOCUS_CHAIN, context, {})
}
