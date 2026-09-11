import type { McpServer } from "./mcp"

/**
 * Dynamic MCP tool availability: types and the pure effective-tool-set resolver.
 *
 * Goal: large MCP servers (e.g. an Atlassian server exposing 100+ tools) don't have to be
 * injected into every request's tool schema/prompt just because they're enabled. A skill can
 * declare which of a server's tools it needs; until that skill is active, only "baseline" tools
 * (tools no enabled skill has ever declared) are exposed.
 *
 * This is visibility filtering only, not an authorization boundary — MCP server `disabled`,
 * tool `autoApprove`, and the approval flow remain the real gatekeepers.
 */

export type McpToolAvailability = "always_on" | "always_off" | "dynamic_compatible" | "dynamic_declared_only"

export const DEFAULT_MCP_TOOL_AVAILABILITY: McpToolAvailability = "always_on"

/**
 * Resolves the effective availability setting for the active mode. When Plan/Act aren't split,
 * the shared value is used and the mode-specific fields are ignored entirely — this is what
 * guarantees a stale Plan/Act value can never leak back in if split mode is re-enabled later.
 * When split, the mode-specific value applies, falling back to the shared value until the user
 * has explicitly set one for that mode.
 */
export function resolveMcpToolAvailability(
	planActSeparateModelsSetting: boolean | undefined,
	sharedValue: McpToolAvailability | undefined,
	mode: "plan" | "act",
	planValue: McpToolAvailability | undefined,
	actValue: McpToolAvailability | undefined,
): McpToolAvailability {
	const shared = sharedValue ?? DEFAULT_MCP_TOOL_AVAILABILITY
	if (!planActSeparateModelsSetting) {
		return shared
	}
	return (mode === "plan" ? planValue : actValue) ?? shared
}

/** A single `server:tool_name` (or `server:prefix_*`, etc.) declaration parsed from skill frontmatter. */
export interface McpToolPattern {
	server: string
	toolPattern: string
}

/**
 * Parses "server:tool_pattern" by splitting on the FIRST colon only, since server names are
 * free-form config keys and could theoretically contain a colon themselves. Returns undefined
 * for anything that isn't a non-empty "server:tool" shape; callers should warn and ignore.
 */
export function parseMcpToolPattern(raw: string): McpToolPattern | undefined {
	const trimmed = raw.trim()
	if (!trimmed) return undefined
	const idx = trimmed.indexOf(":")
	if (idx <= 0 || idx === trimmed.length - 1) return undefined
	return { server: trimmed.slice(0, idx), toolPattern: trimmed.slice(idx + 1) }
}

function escapeRegExpLiteral(segment: string): string {
	return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Matches `toolName` against a pattern that supports any number of `*` wildcards (no other glob syntax). */
export function matchesToolPattern(toolPattern: string, toolName: string): boolean {
	if (!toolPattern.includes("*")) {
		return toolPattern === toolName
	}
	const regexSource = toolPattern.split("*").map(escapeRegExpLiteral).join(".*")
	return new RegExp(`^${regexSource}$`).test(toolName)
}

function matchesAny(patterns: readonly McpToolPattern[], serverName: string, toolName: string): boolean {
	return patterns.some((p) => p.server === serverName && matchesToolPattern(p.toolPattern, toolName))
}

/**
 * The currently active skill's own MCP declarations, resolved and frozen at activation time.
 * `allowedDeclared`/`disallowedDeclared` distinguish "field present in frontmatter" (even as an
 * empty list) from "field absent entirely" — see the missing-vs-empty behavior in the resolver.
 */
export interface ActiveSkillMcpPolicy {
	skillName: string
	allowed: McpToolPattern[]
	disallowed: McpToolPattern[]
	allowedDeclared: boolean
	disallowedDeclared: boolean
}

export interface McpServerToolSet {
	serverName: string
	toolNames: readonly string[]
}

/** serverName -> set of tool names currently exposed to the model. */
export type EffectiveMcpToolSet = Map<string, Set<string>>

export function isToolInEffectiveSet(effective: EffectiveMcpToolSet, serverName: string, toolName: string): boolean {
	return effective.get(serverName)?.has(toolName) ?? false
}

/**
 * Per-tool baseline classification (see design decision): a tool is "baseline" (always exposed
 * regardless of skill activation) unless SOME enabled skill's allow/deny declarations reference
 * it specifically. This is deliberately per-tool, not per-server — one skill declaring
 * `agentmemory:search_notes` must not pull the rest of `agentmemory`'s tools out of baseline.
 */
function isBaselineTool(allDeclaredPatterns: readonly McpToolPattern[], serverName: string, toolName: string): boolean {
	return !matchesAny(allDeclaredPatterns, serverName, toolName)
}

/**
 * Resolves the effective (model-visible) MCP tool set.
 *
 * @param servers Enabled MCP servers with their current tool lists (already `disabled`-filtered).
 * @param availability The Always On / Always Off / Dynamic setting in effect for the active mode.
 * @param allDeclaredPatterns Union of allowed+disallowed patterns across ALL enabled skills
 *   (not just the active one) — used only to classify which tools are baseline vs dynamic-managed.
 * @param activeSkill The currently active skill's own policy, if a skill is active this task.
 */
export function resolveEffectiveMcpTools(
	servers: readonly McpServerToolSet[],
	availability: McpToolAvailability,
	allDeclaredPatterns: readonly McpToolPattern[],
	activeSkill: ActiveSkillMcpPolicy | undefined,
): EffectiveMcpToolSet {
	const result: EffectiveMcpToolSet = new Map()

	// Compatible mode's broad fallback applies only when the active skill declared nothing at
	// all (a legacy/unmigrated skill) — not when it explicitly declared an empty allow list.
	const activeSkillHasNoDeclarations =
		!activeSkill || (!activeSkill.allowedDeclared && !activeSkill.disallowedDeclared)

	for (const server of servers) {
		const exposedTools = new Set<string>()

		for (const toolName of server.toolNames) {
			const deniedByActiveSkill = activeSkill ? matchesAny(activeSkill.disallowed, server.serverName, toolName) : false
			if (deniedByActiveSkill) {
				continue // deny always wins, in every mode
			}

			const baseline = isBaselineTool(allDeclaredPatterns, server.serverName, toolName)
			const allowedByActiveSkill = activeSkill ? matchesAny(activeSkill.allowed, server.serverName, toolName) : false

			let include: boolean
			switch (availability) {
				case "always_on":
					include = true
					break
				case "always_off":
					include = baseline
					break
				case "dynamic_compatible":
					include = activeSkillHasNoDeclarations ? true : baseline || allowedByActiveSkill
					break
				case "dynamic_declared_only":
					include = baseline || allowedByActiveSkill
					break
			}

			if (include) {
				exposedTools.add(toolName)
			}
		}

		if (exposedTools.size > 0) {
			result.set(server.serverName, exposedTools)
		}
	}

	return result
}

/**
 * Convenience wrapper for the two prompt-construction call sites: filters a list of real
 * `McpServer`s down to only their effective (currently exposed) tools, given the current
 * SystemPromptContext fields set by task/index.ts.
 *
 * Only `.tools` is filtered — resources, resource templates, and prompts are out of scope for
 * this feature (the token cost measured in the design came from tool schemas, not those) and
 * stay visible even when a server's tools are fully hidden. Callers that only care about tools
 * (the native tool-schema path) naturally get nothing for a server left with an empty array.
 */
export function filterMcpServersToEffectiveTools(
	servers: readonly McpServer[],
	availability: McpToolAvailability | undefined,
	allDeclaredPatterns: readonly McpToolPattern[] | undefined,
	activeSkill: ActiveSkillMcpPolicy | undefined,
): McpServer[] {
	const toolSets: McpServerToolSet[] = servers.map((server) => ({
		serverName: server.name,
		toolNames: (server.tools ?? []).map((tool) => tool.name),
	}))
	const effective = resolveEffectiveMcpTools(
		toolSets,
		availability ?? DEFAULT_MCP_TOOL_AVAILABILITY,
		allDeclaredPatterns ?? [],
		activeSkill,
	)
	return servers.map((server) => ({
		...server,
		tools: (server.tools ?? []).filter((tool) => isToolInEffectiveSet(effective, server.name, tool.name)),
	}))
}
