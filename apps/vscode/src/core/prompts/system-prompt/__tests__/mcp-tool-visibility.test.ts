import { expect } from "chai"
import { describe, it } from "mocha"
import type { McpHub } from "@/services/mcp/McpHub"
import { ActiveSkillMcpPolicy, McpToolPattern, parseMcpToolPattern } from "@/shared/mcpToolPolicy"
import { getSystemPrompt } from "../index"
import type { SystemPromptContext } from "../types"
import { mockProviderInfo } from "./test-fixtures"

// Fixture from the Optional MCP Tools scenario: 7 + 54 + 63 undeclared tools, and a 250-tool server
// where a skill allows only three. Native tool names are `uid + separator + tool`, so Future uses a uid.
const names = (prefix: string, count: number) =>
	Array.from({ length: count }, (_, i) => `${prefix}_${String(i).padStart(3, "0")}`)
const serverOf = (name: string, uid: string, toolNames: string[]) => ({
	name,
	uid,
	status: "connected" as const,
	config: "{}",
	tools: toolNames.map((toolName) => ({
		name: toolName,
		description: toolName,
		inputSchema: { type: "object", properties: {} },
	})),
})
const servers = [
	serverOf("gnosis-mcp", "gnosisuid", names("gnosis", 7)),
	serverOf("agentmemory-mcp", "memoryuid", names("memory", 54)),
	serverOf("atlassian-mcp", "atlassianuid", names("atl", 63)),
	serverOf("future-mcp", "futureuid", names("future", 250)),
]

const declared: McpToolPattern[] = ["future-mcp:future_000", "future-mcp:future_001", "future-mcp:future_002"].map((raw) => {
	const parsed = parseMcpToolPattern(raw)
	if (!parsed) throw new Error(`Expected "${raw}" to parse`)
	return parsed
})
const workingSkill: ActiveSkillMcpPolicy = {
	skillName: "future-task",
	allowed: declared,
	disallowed: [],
	allowedDeclared: true,
	disallowedDeclared: false,
}

function contextFor(
	enableNativeToolCalls: boolean,
	activeSkillMcpPolicy: ActiveSkillMcpPolicy | undefined,
	provider: Partial<typeof mockProviderInfo> = {},
): SystemPromptContext {
	return {
		cwd: "/test/project",
		ide: "TestIde",
		supportsBrowserUse: false,
		providerInfo: { ...mockProviderInfo, ...provider },
		mcpHub: { getServers: () => servers } as unknown as McpHub,
		mcpToolAvailability: "dynamic_declared_only",
		allDeclaredMcpToolPatterns: declared,
		activeSkillMcpPolicy,
		enableNativeToolCalls,
		isTesting: true,
	}
}

// Native-tool-capable provider/model (see NATIVE_NEXT_GEN in integration.test.ts).
const nativeProvider = { providerId: "cline", model: { id: "claude-4-5-sonnet", info: { supportsPromptCache: false } } }

describe("Optional MCP Tools: outgoing tool definitions", () => {
	it("native tool schemas send exactly the three allowed Future tools and none of the other 247", async () => {
		const { tools } = await getSystemPrompt(contextFor(true, workingSkill, nativeProvider))
		const toolNames = (tools as any[]).map((tool) => (tool?.function?.name ?? tool?.name) as string)
		const future = toolNames.filter((name) => name.startsWith("futureuid"))
		expect(future).to.have.length(3)
		for (const allowed of ["future_000", "future_001", "future_002"]) {
			expect(
				future.some((name) => name.endsWith(allowed)),
				allowed,
			).to.be.true
		}
		expect(future.some((name) => name.endsWith("future_003"))).to.be.false
		expect(toolNames.filter((name) => name.startsWith("gnosisuid"))).to.have.length(7)
		expect(toolNames.filter((name) => name.startsWith("memoryuid"))).to.have.length(54)
		expect(toolNames.filter((name) => name.startsWith("atlassianuid"))).to.have.length(63)
	})

	it("native tool schemas send no Future tools without an active skill", async () => {
		const { tools } = await getSystemPrompt(contextFor(true, undefined, nativeProvider))
		const toolNames = (tools as any[]).map((tool) => (tool?.function?.name ?? tool?.name) as string)
		expect(toolNames.some((name) => name.startsWith("futureuid"))).to.be.false
	})

	it("XML/legacy MCP prompt lists the three allowed Future tools and omits the other 247", async () => {
		const { systemPrompt } = await getSystemPrompt(contextFor(false, workingSkill))
		for (const allowed of ["future_000", "future_001", "future_002"]) {
			expect(systemPrompt.includes(allowed), allowed).to.be.true
		}
		expect(systemPrompt.includes("future_003")).to.be.false
		expect(systemPrompt.includes("future_249")).to.be.false
		expect(systemPrompt.includes("gnosis_000")).to.be.true
	})

	it("XML/legacy MCP prompt omits all Future tools without an active skill", async () => {
		const { systemPrompt } = await getSystemPrompt(contextFor(false, undefined))
		expect(systemPrompt.includes("future_000")).to.be.false
		expect(systemPrompt.includes("atl_000")).to.be.true
	})
})
