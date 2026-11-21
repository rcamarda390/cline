import { strict as assert } from "node:assert"
import { Task } from "@core/task"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, it } from "mocha"

function createPendingQuestion() {
	const messages: ClineMessage[] = [
		{
			ts: 1,
			type: "ask",
			ask: "followup",
			text: JSON.stringify({ question: "Which checks?", multiSelectId: "active", options: ["Unit", "Integration", "Lint"] }),
		},
	]
	const taskState = { lastMessageTs: 1, abort: false, askResponse: undefined, askResponseText: undefined }
	const task = Object.assign(Object.create(Task.prototype) as Task, {
		taskState,
		messageStateHandler: { getClineMessages: () => messages },
	})
	return { task, taskState }
}

describe("Task.submitMultiSelectAnswer", () => {
	it("returns selected labels in display order and consumes the answer once", async () => {
		const { task, taskState } = createPendingQuestion()
		await task.handleWebviewAskResponse("messageResponse", "Free text")
		assert.equal(taskState.askResponse, undefined)
		const submission = JSON.stringify({ id: "active", indices: [2, 0] })
		await task.submitMultiSelectAnswer(submission)
		assert.equal(taskState.askResponse, "messageResponse")
		assert.equal(taskState.askResponseText, JSON.stringify({ selected: ["Unit", "Lint"] }))
		await assert.rejects(task.submitMultiSelectAnswer(submission))
	})

	it("keeps the question pending for invalid answers and rejects canceled or superseded questions", async () => {
		const { task, taskState } = createPendingQuestion()
		const submit = (id: string, indices: number[]) => task.submitMultiSelectAnswer(JSON.stringify({ id, indices }))
		await assert.rejects(submit("stale", [0]))
		await assert.rejects(submit("active", []))
		await assert.rejects(submit("active", [1, 1]))
		await assert.rejects(submit("active", [3]))
		taskState.abort = true
		await assert.rejects(submit("active", [0]))
		taskState.abort = false
		taskState.lastMessageTs = 2
		await assert.rejects(submit("active", [0]))
		assert.equal(taskState.askResponse, undefined)
	})
})
