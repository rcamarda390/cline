import { getTaskMetadata, saveTaskMetadata } from "@core/storage/disk"
import { aggregateSkillMcpPolicies } from "@shared/mcpToolPolicy"
import { Logger } from "@/shared/services/Logger"
import type { TaskState } from "./TaskState"

/** The single aggregate every enforcement path (prompt, native schemas, execution) must use. */
export function getAggregateSkillMcpPolicy(taskState: Pick<TaskState, "loadedSkillMcpPolicies" | "skillMcpPolicyRestoreFailed">) {
	return aggregateSkillMcpPolicies(taskState.loadedSkillMcpPolicies, taskState.skillMcpPolicyRestoreFailed)
}

/**
 * Persists the CURRENT in-memory collection as v2 state (retiring the legacy singular field).
 * Writes are chained so concurrent activations can't persist a stale snapshot over a newer one;
 * each write re-reads the live collection, so the last write always carries every entry.
 * Returns false (after logging) if durability could not be confirmed.
 */
export function persistSkillMcpPolicyState(taskState: TaskState, taskId: string): Promise<boolean> {
	const run = async (): Promise<boolean> => {
		try {
			const metadata = await getTaskMetadata(taskId)
			metadata.skill_mcp_policy_state = {
				version: 2,
				policies: taskState.loadedSkillMcpPolicies.map((p) => ({ ...p })),
				...(taskState.skillMcpPolicyRestoreFailed ? { restoreFailed: true } : {}),
			}
			delete metadata.active_skill_mcp_policy
			await saveTaskMetadata(taskId, metadata)
			return true
		} catch (error) {
			Logger.warn(
				`Failed to persist loaded skill MCP policies; resume durability NOT confirmed for task ${taskId}: ${(error as Error)?.message}`,
			)
			return false
		}
	}
	const result = taskState.skillMcpPolicyPersistChain.then(run, run)
	taskState.skillMcpPolicyPersistChain = result.then(
		() => undefined,
		() => undefined,
	)
	return result
}
