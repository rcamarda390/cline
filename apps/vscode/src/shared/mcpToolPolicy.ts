import type { McpServer } from "./mcp"

/**
 * Dynamic MCP tool availability: types and the pure effective-tool-set resolver.
 *
 * Goal: large MCP servers (e.g. an Atlassian server exposing 100+ tools) don't have to be
 * injected into every request's tool schema/prompt just because they're enabled. A skill can
 * declare which of a server's tools it needs. Once ANY enabled skill references a server, that
 * server is "managed": until a skill that allows a tool is active, the tool is not exposed.
 * Servers no enabled skill references stay "baseline" and are exposed in full.
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

/** Allow/deny declarations driving the resolver. Either one skill's own, or the aggregate of all loaded skills. */
export interface McpPolicyDeclarations {
	allowed: McpToolPattern[]
	disallowed: McpToolPattern[]
	/** Field present in frontmatter (even as an empty list) vs. absent entirely. */
	allowedDeclared: boolean
	disallowedDeclared: boolean
}

/** One loaded skill's MCP declarations, resolved and frozen at activation time. */
export interface ActiveSkillMcpPolicy extends McpPolicyDeclarations {
	skillName: string
}

/** Persisted (task metadata) plural snapshot. Replaces the legacy singular `active_skill_mcp_policy`. */
export interface SkillMcpPolicyState {
	version: 2
	policies: ActiveSkillMcpPolicy[]
	/** Set when an earlier restore failed; keeps the fail-closed marker across save/resume. */
	restoreFailed?: boolean
}

const patternKey = (p: McpToolPattern) => `${p.server}\u0000${p.toolPattern}`

function mergePatterns(lists: readonly McpToolPattern[][]): McpToolPattern[] {
	const seen = new Set<string>()
	const out: McpToolPattern[] = []
	for (const p of lists.flat()) {
		const key = patternKey(p)
		if (!seen.has(key)) {
			seen.add(key)
			out.push({ server: p.server, toolPattern: p.toolPattern })
		}
	}
	return out
}

/**
 * Aggregates the policies of all LOADED skills (never installed-but-unloaded ones): allows and
 * denies are unioned (deny wins in the resolver), declaration flags are OR-ed so a plain skill
 * loaded after a declared one cannot reset the aggregate to "no declarations".
 *
 * `restoreFailed` marks declared state that could not be restored on resume: the aggregate then
 * counts as declared (with no allows), so Dynamic modes keep managed tools hidden instead of
 * taking Compatible's undeclared fallback.
 *
 * Returns undefined when nothing is loaded and nothing failed.
 */
export function aggregateSkillMcpPolicies(
	policies: readonly ActiveSkillMcpPolicy[],
	restoreFailed = false,
): McpPolicyDeclarations | undefined {
	if (policies.length === 0 && !restoreFailed) return undefined
	return {
		allowed: mergePatterns(policies.map((p) => p.allowed)),
		disallowed: mergePatterns(policies.map((p) => p.disallowed)),
		allowedDeclared: restoreFailed || policies.some((p) => p.allowedDeclared),
		disallowedDeclared: policies.some((p) => p.disallowedDeclared),
	}
}

/** Returns a copy of the policy detached from discovery objects (later mutation can't change it). */
export function freezeSkillMcpPolicy(skillName: string, d: McpPolicyDeclarations): ActiveSkillMcpPolicy {
	return {
		skillName,
		allowed: d.allowed.map((p) => ({ ...p })),
		disallowed: d.disallowed.map((p) => ({ ...p })),
		allowedDeclared: d.allowedDeclared,
		disallowedDeclared: d.disallowedDeclared,
	}
}

function isPattern(x: unknown): x is McpToolPattern {
	const p = x as McpToolPattern
	return !!p && typeof p.server === "string" && p.server !== "" && typeof p.toolPattern === "string" && p.toolPattern !== ""
}

export function isActiveSkillMcpPolicy(x: unknown): x is ActiveSkillMcpPolicy {
	const p = x as ActiveSkillMcpPolicy
	return (
		!!p &&
		typeof p.skillName === "string" &&
		Array.isArray(p.allowed) &&
		p.allowed.every(isPattern) &&
		Array.isArray(p.disallowed) &&
		p.disallowed.every(isPattern) &&
		typeof p.allowedDeclared === "boolean" &&
		typeof p.disallowedDeclared === "boolean"
	)
}

export interface ParsedSkillMcpPolicyState {
	policies: ActiveSkillMcpPolicy[]
	/** Metadata was present but malformed/unsupported: callers must fail closed in Dynamic modes. */
	corrupt: boolean
}

/**
 * Reads persisted metadata. Prefers the v2 plural state (even when empty, so a stale legacy
 * field can't resurrect); falls back to the legacy singular snapshot as one entry.
 * Invalid entries inside a v2 state mark the whole state corrupt (valid siblings are kept).
 */
export function parseSkillMcpPolicyMetadata(metadata: {
	skill_mcp_policy_state?: unknown
	active_skill_mcp_policy?: unknown
}): ParsedSkillMcpPolicyState {
	const state = metadata.skill_mcp_policy_state as SkillMcpPolicyState | undefined
	if (state !== undefined) {
		if (!state || state.version !== 2 || !Array.isArray(state.policies)) {
			return { policies: [], corrupt: true }
		}
		const valid = state.policies.filter(isActiveSkillMcpPolicy)
		return { policies: dedupeBySkill(valid), corrupt: state.restoreFailed === true || valid.length !== state.policies.length }
	}
	const legacy = metadata.active_skill_mcp_policy
	if (legacy === undefined) return { policies: [], corrupt: false }
	return isActiveSkillMcpPolicy(legacy) ? { policies: [legacy], corrupt: false } : { policies: [], corrupt: true }
}

function dedupeBySkill(policies: ActiveSkillMcpPolicy[]): ActiveSkillMcpPolicy[] {
	const seen = new Set<string>()
	return policies.filter((p) => !seen.has(p.skillName) && !!seen.add(p.skillName))
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
 * Resolves the effective (model-visible) MCP tool set.
 *
 * @param servers Enabled MCP servers with their current tool lists (already `disabled`-filtered).
 * @param availability The Always On / Always Off / Dynamic setting in effect for the active mode.
 * @param allDeclaredPatterns Union of allowed+disallowed patterns across ALL enabled skills
 *   (not just the loaded ones). Used only to classify servers: a server named by any pattern
 *   here is managed; the tool-name part of a pattern does not matter for classification.
 * @param activeSkill Aggregate policy of all skills loaded this task (see aggregateSkillMcpPolicies).
 */
export function resolveEffectiveMcpTools(
	servers: readonly McpServerToolSet[],
	availability: McpToolAvailability,
	allDeclaredPatterns: readonly McpToolPattern[],
	activeSkill: McpPolicyDeclarations | undefined,
): EffectiveMcpToolSet {
	const result: EffectiveMcpToolSet = new Map()

	// Server-level classification: a server referenced by ANY enabled skill is managed, even if
	// its pattern matches no current tool. Exact server-key match only. Unmanaged servers are
	// baseline and fully exposed in every mode.
	const managedServers = new Set(allDeclaredPatterns.map((p) => p.server))

	// Compatible mode's broad fallback applies only when the active skill declared nothing at
	// all (a legacy/unmigrated skill) — not when it explicitly declared an empty allow list.
	const activeSkillHasNoDeclarations = !activeSkill || (!activeSkill.allowedDeclared && !activeSkill.disallowedDeclared)

	for (const server of servers) {
		const baseline = !managedServers.has(server.serverName)
		const exposedTools = new Set<string>()

		for (const toolName of server.toolNames) {
			const deniedByActiveSkill = activeSkill ? matchesAny(activeSkill.disallowed, server.serverName, toolName) : false
			if (deniedByActiveSkill) {
				continue // deny always wins, in every mode
			}

			// Tool selection inside a managed server stays per tool: only loaded skills' allows count.
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
	activeSkill: McpPolicyDeclarations | undefined,
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
