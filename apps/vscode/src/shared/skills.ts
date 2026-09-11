import type { McpToolPattern } from "./mcpToolPolicy"

/**
 * A skill's parsed MCP tool declarations, used both for baseline classification (does ANY
 * enabled skill reference this tool) and, once this skill is active, for its own effective set.
 */
export interface SkillMcpToolDeclarations {
	allowed: McpToolPattern[]
	disallowed: McpToolPattern[]
	/** True when the field was present in frontmatter at all, even as an empty list. */
	allowedDeclared: boolean
	disallowedDeclared: boolean
}

/**
 * Skill metadata loaded at startup for discovery.
 * Only name, description, and MCP tool declarations are parsed from frontmatter initially —
 * the declarations are cheap (frontmatter is already parsed for name/description) and are
 * needed up front so baseline MCP tool classification works before any skill is activated.
 *
 * `mcpTools` is optional (rather than defaulted at every call site) so existing code — and
 * tests — constructing a bare `{ name, description, path, source }` keeps working; treat a
 * missing `mcpTools` the same as a skill that declared nothing, via `getSkillMcpToolDeclarations`.
 */
export interface SkillMetadata {
	name: string
	description: string
	path: string
	source: "global" | "project"
	mcpTools?: SkillMcpToolDeclarations
}

export const NO_MCP_TOOL_DECLARATIONS: SkillMcpToolDeclarations = {
	allowed: [],
	disallowed: [],
	allowedDeclared: false,
	disallowedDeclared: false,
}

export function getSkillMcpToolDeclarations(skill: Pick<SkillMetadata, "mcpTools">): SkillMcpToolDeclarations {
	return skill.mcpTools ?? NO_MCP_TOOL_DECLARATIONS
}

/**
 * Full skill content loaded on-demand when skill is activated.
 */
export interface SkillContent extends SkillMetadata {
	instructions: string
}
