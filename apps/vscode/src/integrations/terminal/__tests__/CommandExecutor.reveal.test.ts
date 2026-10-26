import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { CommandExecutor } from "../CommandExecutor"

describe("CommandExecutor terminal reveal", () => {
	it("reveals the terminal without taking keyboard focus", async () => {
		const calls: unknown[][] = []
		const terminal = {
			show: (...args: unknown[]) => calls.push(args),
		}
		const terminalManager = {
			shellIntegrationTimeout: 4000,
			getOrCreateTerminal: async () => ({ terminal }),
			runCommand: () => {
				throw new Error("stop after reveal")
			},
		}
		const executor = new CommandExecutor(
			{ cwd: "/tmp", taskId: "t", ulid: "u", terminalExecutionMode: "vscodeTerminal", terminalManager } as any,
			{} as any,
		)

		await assert.rejects(executor.execute("echo hi", undefined), /stop after reveal/)
		assert.deepEqual(calls, [[true]])
	})
})
