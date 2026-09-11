import { expect } from "chai"
import { describe, it } from "mocha"
import {
	ActiveSkillMcpPolicy,
	matchesToolPattern,
	McpServerToolSet,
	McpToolPattern,
	parseMcpToolPattern,
	resolveEffectiveMcpTools,
	resolveMcpToolAvailability,
} from "../mcpToolPolicy"

function pattern(raw: string): McpToolPattern {
	const parsed = parseMcpToolPattern(raw)
	if (!parsed) throw new Error(`Expected "${raw}" to parse`)
	return parsed
}

function policy(
	skillName: string,
	allowed: string[],
	disallowed: string[],
	overrides: Partial<Pick<ActiveSkillMcpPolicy, "allowedDeclared" | "disallowedDeclared">> = {},
): ActiveSkillMcpPolicy {
	return {
		skillName,
		allowed: allowed.map(pattern),
		disallowed: disallowed.map(pattern),
		allowedDeclared: overrides.allowedDeclared ?? allowed.length > 0,
		disallowedDeclared: overrides.disallowedDeclared ?? disallowed.length > 0,
	}
}

describe("mcpToolPolicy", () => {
	describe("parseMcpToolPattern", () => {
		it("splits on the first colon only", () => {
			expect(parseMcpToolPattern("atlassian-mcp:jira_get_issue")).to.deep.equal({
				server: "atlassian-mcp",
				toolPattern: "jira_get_issue",
			})
		})

		it("treats extra colons as part of the tool pattern", () => {
			expect(parseMcpToolPattern("server:weird:tool")).to.deep.equal({
				server: "server",
				toolPattern: "weird:tool",
			})
		})

		it("rejects entries with no colon, empty server, or empty tool", () => {
			expect(parseMcpToolPattern("no-colon-here")).to.be.undefined
			expect(parseMcpToolPattern(":tool")).to.be.undefined
			expect(parseMcpToolPattern("server:")).to.be.undefined
			expect(parseMcpToolPattern("  ")).to.be.undefined
		})
	})

	describe("matchesToolPattern", () => {
		it("matches exact names with no wildcard", () => {
			expect(matchesToolPattern("jira_get_issue", "jira_get_issue")).to.be.true
			expect(matchesToolPattern("jira_get_issue", "jira_get_issues")).to.be.false
		})

		it("supports a prefix wildcard", () => {
			expect(matchesToolPattern("jira_*", "jira_get_issue")).to.be.true
			expect(matchesToolPattern("jira_*", "confluence_get_page")).to.be.false
		})

		it("supports a suffix wildcard", () => {
			expect(matchesToolPattern("*_delete", "jira_delete")).to.be.true
			expect(matchesToolPattern("*_delete", "jira_delete_bulk")).to.be.false
		})

		it("supports multiple wildcards in one pattern", () => {
			expect(matchesToolPattern("*jira*confluence*", "jira_and_confluence_sync")).to.be.true
			expect(matchesToolPattern("*jira*confluence*", "jira_only")).to.be.false
		})

		it("supports a bare '*' matching every tool on the server", () => {
			expect(matchesToolPattern("*", "anything")).to.be.true
		})

		it("escapes regex metacharacters in the literal segments", () => {
			expect(matchesToolPattern("get.issue", "get.issue")).to.be.true
			expect(matchesToolPattern("get.issue", "getXissue")).to.be.false
		})
	})

	describe("resolveEffectiveMcpTools", () => {
		const atlassian: McpServerToolSet = {
			serverName: "atlassian-mcp",
			toolNames: ["jira_get_issue", "jira_delete_issue", "confluence_get_page"],
		}
		const agentmemory: McpServerToolSet = {
			serverName: "agentmemory",
			toolNames: ["search_notes", "write_note"],
		}
		const servers = [atlassian, agentmemory]

		it("Always On exposes everything regardless of skill state", () => {
			const effective = resolveEffectiveMcpTools(servers, "always_on", [], undefined)
			expect([...(effective.get("atlassian-mcp") ?? [])].sort()).to.deep.equal([
				"confluence_get_page",
				"jira_delete_issue",
				"jira_get_issue",
			])
			expect([...(effective.get("agentmemory") ?? [])].sort()).to.deep.equal(["search_notes", "write_note"])
		})

		it("Always Off with no declarations anywhere still exposes baseline (nothing is dynamic yet)", () => {
			const effective = resolveEffectiveMcpTools(servers, "always_off", [], undefined)
			expect(effective.get("atlassian-mcp")?.size).to.equal(3)
		})

		it("per-tool baseline: declaring one agentmemory tool does not hide the rest of the server", () => {
			const allDeclared = [pattern("agentmemory:search_notes"), pattern("atlassian-mcp:jira_*")]
			// No active skill (baseline state, e.g. an unrelated task) — the mere existence of a
			// declaration elsewhere must not remove agentmemory:write_note or atlassian's
			// confluence tool from baseline.
			const effective = resolveEffectiveMcpTools(servers, "dynamic_declared_only", allDeclared, undefined)
			expect(effective.get("agentmemory")?.has("write_note")).to.be.true
			expect(effective.get("agentmemory")?.has("search_notes")).to.be.false // dynamic-managed now
			expect(effective.get("atlassian-mcp")?.has("confluence_get_page")).to.be.true // untouched, baseline
			expect(effective.get("atlassian-mcp")?.has("jira_get_issue")).to.be.false // matched by jira_*, dynamic
		})

		it("Dynamic Declared Only: active skill's allow patterns add matching tools back", () => {
			const allDeclared = [pattern("atlassian-mcp:jira_*")]
			const active = policy("jira-skill", ["atlassian-mcp:jira_get_issue"], [])
			const effective = resolveEffectiveMcpTools(servers, "dynamic_declared_only", allDeclared, active)
			expect(effective.get("atlassian-mcp")?.has("jira_get_issue")).to.be.true
			expect(effective.get("atlassian-mcp")?.has("jira_delete_issue")).to.be.false // matched jira_* baseline-removal, not re-allowed
			expect(effective.get("atlassian-mcp")?.has("confluence_get_page")).to.be.true // never declared anywhere, stays baseline
		})

		it("deny always wins over allow, in every mode", () => {
			const allDeclared = [pattern("atlassian-mcp:jira_*")]
			const active = policy("jira-skill", ["atlassian-mcp:jira_*"], ["atlassian-mcp:jira_delete_issue"])
			for (const mode of ["always_on", "always_off", "dynamic_compatible", "dynamic_declared_only"] as const) {
				const effective = resolveEffectiveMcpTools(servers, mode, allDeclared, active)
				expect(effective.get("atlassian-mcp")?.has("jira_delete_issue"), `mode=${mode}`).to.be.false
			}
		})

		it("Dynamic Compatible: skill with zero declarations falls back to all enabled tools", () => {
			const active = policy("legacy-skill", [], [])
			const effective = resolveEffectiveMcpTools(servers, "dynamic_compatible", [], active)
			expect(effective.get("atlassian-mcp")?.size).to.equal(3)
			expect(effective.get("agentmemory")?.size).to.equal(2)
		})

		it("Dynamic Compatible: explicit empty allow list does NOT trigger the broad fallback", () => {
			const active = policy("annotated-skill", [], [], { allowedDeclared: true })
			const effective = resolveEffectiveMcpTools(servers, "dynamic_compatible", [], active)
			// Nothing was ever declared by any skill, so everything is still baseline — but the
			// fallback-to-all-enabled path must not have fired for this skill.
			expect(effective.get("atlassian-mcp")?.size).to.equal(3)
		})

		it("Dynamic Compatible: explicit empty allow list restricts to baseline once other skills go dynamic", () => {
			const allDeclared = [pattern("atlassian-mcp:jira_*")]
			const active = policy("annotated-skill", [], [], { allowedDeclared: true })
			const effective = resolveEffectiveMcpTools(servers, "dynamic_compatible", allDeclared, active)
			expect(effective.get("atlassian-mcp")?.has("jira_get_issue")).to.be.false
			expect(effective.get("atlassian-mcp")?.has("confluence_get_page")).to.be.true
		})

		it("Dynamic Compatible: only disallowed_mcp_tools declared still counts as declared (all-enabled minus denies)", () => {
			const active = policy("deny-only-skill", [], ["atlassian-mcp:jira_delete_issue"])
			const effective = resolveEffectiveMcpTools(servers, "dynamic_compatible", [], active)
			expect(effective.get("atlassian-mcp")?.has("jira_get_issue")).to.be.true
			expect(effective.get("atlassian-mcp")?.has("jira_delete_issue")).to.be.false
		})

		it("Dynamic Declared Only: missing declarations expose nothing beyond baseline", () => {
			const allDeclared = [pattern("atlassian-mcp:jira_*")]
			const active = policy("legacy-skill", [], [])
			const effective = resolveEffectiveMcpTools(servers, "dynamic_declared_only", allDeclared, active)
			expect(effective.get("atlassian-mcp")?.has("jira_get_issue")).to.be.false
			expect(effective.get("atlassian-mcp")?.has("confluence_get_page")).to.be.true
		})

		it("omits a server entirely from the map when it has zero exposed tools", () => {
			const allDeclared = [pattern("agentmemory:*")]
			const active = policy("other-skill", [], [])
			const effective = resolveEffectiveMcpTools([agentmemory], "dynamic_declared_only", allDeclared, active)
			expect(effective.has("agentmemory")).to.be.false
		})
	})

	describe("resolveMcpToolAvailability", () => {
		it("uses the shared value and ignores plan/act fields when not split", () => {
			const result = resolveMcpToolAvailability(false, "dynamic_compatible", "plan", "always_off", "always_on")
			expect(result).to.equal("dynamic_compatible")
		})

		it("falls back to the default when shared is unset and not split", () => {
			expect(resolveMcpToolAvailability(false, undefined, "act", undefined, undefined)).to.equal("always_on")
		})

		it("uses the active mode's value when split", () => {
			expect(resolveMcpToolAvailability(true, "always_on", "plan", "dynamic_declared_only", "always_off")).to.equal(
				"dynamic_declared_only",
			)
			expect(resolveMcpToolAvailability(true, "always_on", "act", "dynamic_declared_only", "always_off")).to.equal(
				"always_off",
			)
		})

		it("falls back to shared when split but the active mode has no value set yet", () => {
			expect(resolveMcpToolAvailability(true, "dynamic_compatible", "plan", undefined, "always_off")).to.equal(
				"dynamic_compatible",
			)
		})
	})
})
