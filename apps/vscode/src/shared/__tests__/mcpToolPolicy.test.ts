import { expect } from "chai"
import { describe, it } from "mocha"
import {
	ActiveSkillMcpPolicy,
	EffectiveMcpToolSet,
	isToolInEffectiveSet,
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

		it("server-level baseline: a declaration manages its whole server, undeclared servers stay exposed", () => {
			const allDeclared = [pattern("agentmemory:search_notes")]
			// No active skill. Declaring one agentmemory tool marks agentmemory as managed, so its
			// write_note is hidden too. atlassian-mcp is referenced by no skill, so it stays fully exposed.
			const effective = resolveEffectiveMcpTools(servers, "dynamic_declared_only", allDeclared, undefined)
			expect(isToolInEffectiveSet(effective, "agentmemory", "write_note")).to.be.false
			expect(isToolInEffectiveSet(effective, "agentmemory", "search_notes")).to.be.false
			expect(effective.get("atlassian-mcp")?.size).to.equal(3)
		})

		it("Dynamic Declared Only: active skill's allow patterns add matching tools back", () => {
			const allDeclared = [pattern("atlassian-mcp:jira_*")]
			const active = policy("jira-skill", ["atlassian-mcp:jira_get_issue"], [])
			const effective = resolveEffectiveMcpTools(servers, "dynamic_declared_only", allDeclared, active)
			expect(effective.get("atlassian-mcp")?.has("jira_get_issue")).to.be.true
			expect(effective.get("atlassian-mcp")?.has("jira_delete_issue")).to.be.false // managed server, not allowed
			expect(effective.get("atlassian-mcp")?.has("confluence_get_page")).to.be.false // same server, not allowed either
			expect(effective.get("agentmemory")?.has("search_notes")).to.be.true // no skill references agentmemory, stays baseline
		})

		it("deny always wins over allow, in every mode", () => {
			const allDeclared = [pattern("atlassian-mcp:jira_*")]
			const active = policy("jira-skill", ["atlassian-mcp:jira_*"], ["atlassian-mcp:jira_delete_issue"])
			for (const mode of ["always_on", "always_off", "dynamic_compatible", "dynamic_declared_only"] as const) {
				const effective = resolveEffectiveMcpTools(servers, mode, allDeclared, active)
				expect(isToolInEffectiveSet(effective, "atlassian-mcp", "jira_delete_issue"), `mode=${mode}`).to.be.false
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

		it("Dynamic Compatible: explicit empty allow list leaves a managed server with nothing exposed", () => {
			const allDeclared = [pattern("atlassian-mcp:jira_*")]
			const active = policy("annotated-skill", [], [], { allowedDeclared: true })
			const effective = resolveEffectiveMcpTools(servers, "dynamic_compatible", allDeclared, active)
			expect(isToolInEffectiveSet(effective, "atlassian-mcp", "jira_get_issue")).to.be.false
			expect(isToolInEffectiveSet(effective, "atlassian-mcp", "confluence_get_page")).to.be.false
			expect(isToolInEffectiveSet(effective, "agentmemory", "search_notes")).to.be.true
		})

		it("Dynamic Compatible: a deny-only declaration marks its server managed, so only allowed tools remain", () => {
			// Deny is not allow-all: the server is managed with no allow, so none of its tools are exposed.
			const allDeclared = [pattern("atlassian-mcp:jira_delete_issue")]
			const active = policy("deny-only-skill", [], ["atlassian-mcp:jira_delete_issue"])
			const effective = resolveEffectiveMcpTools(servers, "dynamic_compatible", allDeclared, active)
			expect(isToolInEffectiveSet(effective, "atlassian-mcp", "jira_get_issue")).to.be.false
			expect(isToolInEffectiveSet(effective, "atlassian-mcp", "jira_delete_issue")).to.be.false
			expect(effective.get("agentmemory")?.size).to.equal(2)
		})

		it("Dynamic Declared Only: missing declarations expose nothing from a managed server", () => {
			const allDeclared = [pattern("atlassian-mcp:jira_*")]
			const active = policy("legacy-skill", [], [])
			const effective = resolveEffectiveMcpTools(servers, "dynamic_declared_only", allDeclared, active)
			expect(isToolInEffectiveSet(effective, "atlassian-mcp", "jira_get_issue")).to.be.false
			expect(isToolInEffectiveSet(effective, "atlassian-mcp", "confluence_get_page")).to.be.false
			expect(isToolInEffectiveSet(effective, "agentmemory", "search_notes")).to.be.true
		})

		it("omits a server entirely from the map when it has zero exposed tools", () => {
			const allDeclared = [pattern("agentmemory:*")]
			const active = policy("other-skill", [], [])
			const effective = resolveEffectiveMcpTools([agentmemory], "dynamic_declared_only", allDeclared, active)
			expect(effective.has("agentmemory")).to.be.false
		})
	})

	describe("server-level classification with large servers", () => {
		const MODES = ["always_on", "always_off", "dynamic_compatible", "dynamic_declared_only"] as const
		const names = (prefix: string, count: number) =>
			Array.from({ length: count }, (_, i) => `${prefix}_${String(i).padStart(3, "0")}`)
		const gnosis: McpServerToolSet = { serverName: "gnosis-mcp", toolNames: names("gnosis", 7) }
		const agentmemory: McpServerToolSet = { serverName: "agentmemory-mcp", toolNames: names("memory", 54) }
		const atlassian: McpServerToolSet = { serverName: "atlassian-mcp", toolNames: names("atl", 63) }
		const future: McpServerToolSet = { serverName: "future-mcp", toolNames: names("future", 250) }
		const everything = [gnosis, agentmemory, atlassian, future]
		const futureDeclared = ["future-mcp:future_000", "future-mcp:future_001", "future-mcp:future_002"].map(pattern)
		const workingSkill = policy(
			"future-task",
			["future-mcp:future_000", "future-mcp:future_001", "future-mcp:future_002"],
			[],
		)

		const count = (effective: EffectiveMcpToolSet, server: string) => effective.get(server)?.size ?? 0
		const total = (effective: EffectiveMcpToolSet) => [...effective.values()].reduce((n, tools) => n + tools.size, 0)

		it("A: no active skill sends 124 tools and zero Future tools", () => {
			const effective = resolveEffectiveMcpTools(everything, "dynamic_declared_only", futureDeclared, undefined)
			expect(count(effective, "gnosis-mcp")).to.equal(7)
			expect(count(effective, "agentmemory-mcp")).to.equal(54)
			expect(count(effective, "atlassian-mcp")).to.equal(63)
			expect(count(effective, "future-mcp")).to.equal(0)
			expect(total(effective)).to.equal(124)
		})

		it("A: the allowing skill active sends exactly its three Future tools and excludes the other 247", () => {
			const effective = resolveEffectiveMcpTools(everything, "dynamic_declared_only", futureDeclared, workingSkill)
			expect(count(effective, "gnosis-mcp")).to.equal(7)
			expect(count(effective, "agentmemory-mcp")).to.equal(54)
			expect(count(effective, "atlassian-mcp")).to.equal(63)
			expect([...(effective.get("future-mcp") ?? [])].sort()).to.deep.equal(["future_000", "future_001", "future_002"])
			expect(total(effective)).to.equal(127)
		})

		it("B: with no declarations anywhere, every mode exposes all 374 enabled tools", () => {
			for (const mode of MODES) {
				expect(total(resolveEffectiveMcpTools(everything, mode, [], undefined)), `mode=${mode}`).to.equal(374)
			}
		})

		it("C: Dynamic Compatible keeps the broad fallback for no skill and for a legacy skill with no declarations", () => {
			const legacy = policy("legacy-skill", [], [])
			expect(total(resolveEffectiveMcpTools(everything, "dynamic_compatible", futureDeclared, undefined))).to.equal(374)
			expect(total(resolveEffectiveMcpTools(everything, "dynamic_compatible", futureDeclared, legacy))).to.equal(374)
		})

		it("C: Dynamic Compatible with the allowing skill sends exactly three Future tools", () => {
			const effective = resolveEffectiveMcpTools(everything, "dynamic_compatible", futureDeclared, workingSkill)
			expect(count(effective, "future-mcp")).to.equal(3)
			expect(total(effective)).to.equal(127)
		})

		it("C: an explicit empty allow list gives zero Future tools while unmanaged servers stay visible", () => {
			const emptyAllow = policy("annotated-skill", [], [], { allowedDeclared: true })
			const effective = resolveEffectiveMcpTools(everything, "dynamic_compatible", futureDeclared, emptyAllow)
			expect(count(effective, "future-mcp")).to.equal(0)
			expect(total(effective)).to.equal(124)
		})

		it("D: Always On with the working skill active exposes all 250 Future tools", () => {
			const effective = resolveEffectiveMcpTools(everything, "always_on", futureDeclared, workingSkill)
			expect(count(effective, "future-mcp")).to.equal(250)
		})

		it("D: Always Off hides managed Future tools and keeps undeclared servers fully visible", () => {
			const effective = resolveEffectiveMcpTools(everything, "always_off", futureDeclared, workingSkill)
			expect(count(effective, "future-mcp")).to.equal(0)
			expect(total(effective)).to.equal(124)
		})

		it("E: an active allow overlapping a deny omits the denied tool in every mode", () => {
			const active = policy("overlap", ["future-mcp:future_*"], ["future-mcp:future_002"])
			for (const mode of MODES) {
				const effective = resolveEffectiveMcpTools(everything, mode, futureDeclared, active)
				expect(isToolInEffectiveSet(effective, "future-mcp", "future_002"), `mode=${mode}`).to.be.false
			}
		})

		it("E: a deny-only active skill exposes zero tools from its server in restrictive modes, but Always On omits only the denied tool", () => {
			const denyOnly = policy("deny-only", [], ["future-mcp:future_000"])
			const allDeclared = [pattern("future-mcp:future_000")]
			expect(
				count(resolveEffectiveMcpTools(everything, "dynamic_declared_only", allDeclared, denyOnly), "future-mcp"),
			).to.equal(0)
			expect(count(resolveEffectiveMcpTools(everything, "always_off", allDeclared, denyOnly), "future-mcp")).to.equal(0)
			const alwaysOn = resolveEffectiveMcpTools(everything, "always_on", allDeclared, denyOnly)
			expect(count(alwaysOn, "future-mcp")).to.equal(249)
			expect(isToolInEffectiveSet(alwaysOn, "future-mcp", "future_000")).to.be.false
		})

		it("F: an active unrelated skill cannot expose Future tools it does not allow", () => {
			const unrelated = policy("gnosis-task", ["gnosis-mcp:*"], [])
			expect(
				count(resolveEffectiveMcpTools(everything, "dynamic_declared_only", futureDeclared, unrelated), "future-mcp"),
			).to.equal(0)
			expect(
				count(resolveEffectiveMcpTools(everything, "dynamic_compatible", futureDeclared, unrelated), "future-mcp"),
			).to.equal(0)
		})

		it("F: the active skill cannot inherit allows from another enabled skill", () => {
			// Another enabled skill allows future_000..future_009; the active skill allows only three.
			const allDeclared = [...futureDeclared, pattern("future-mcp:future_00*")]
			const effective = resolveEffectiveMcpTools(everything, "dynamic_declared_only", allDeclared, workingSkill)
			expect(count(effective, "future-mcp")).to.equal(3)
			expect(isToolInEffectiveSet(effective, "future-mcp", "future_005")).to.be.false
		})

		it("F: with no enabled declarations (disabled skills are filtered out by the caller) the server stays baseline", () => {
			// The caller passes only enabled skills' patterns; a disabled skill's declarations never reach here.
			const effective = resolveEffectiveMcpTools(everything, "dynamic_declared_only", [], undefined)
			expect(count(effective, "future-mcp")).to.equal(250)
		})

		it("G: a tool wildcard allows only the matching tools", () => {
			const active = policy("wildcard", ["future-mcp:future_00*"], [])
			const effective = resolveEffectiveMcpTools(everything, "dynamic_declared_only", futureDeclared, active)
			expect(count(effective, "future-mcp")).to.equal(10)
		})

		it("G: server keys match exactly and do not bleed into similarly named servers", () => {
			const lookalike: McpServerToolSet = { serverName: "future-mcp-archive", toolNames: names("archive", 5) }
			const effective = resolveEffectiveMcpTools([future, lookalike], "dynamic_declared_only", futureDeclared, undefined)
			expect(count(effective, "future-mcp-archive")).to.equal(5)
			expect(count(effective, "future-mcp")).to.equal(0)
		})

		it("G: a valid pattern matching no current tool still marks its server managed", () => {
			const declared = [pattern("atlassian-mcp:jira_renamed_later")]
			const effective = resolveEffectiveMcpTools([atlassian], "dynamic_declared_only", declared, undefined)
			expect(effective.has("atlassian-mcp")).to.be.false
		})

		it("G: empty declarations reference no server", () => {
			const effective = resolveEffectiveMcpTools(everything, "dynamic_declared_only", [], policy("empty", [], []))
			expect(total(effective)).to.equal(374)
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
