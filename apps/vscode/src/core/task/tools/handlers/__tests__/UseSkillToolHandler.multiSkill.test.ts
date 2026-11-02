import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import * as policyModule from "../../../skillMcpPolicy"
import type { TaskConfig } from "../../types/TaskConfig"
import { UseSkillToolHandler } from "../UseSkillToolHandler"

let tmpDir: string
let persist: sinon.SinonStub

async function writeSkill(name: string, frontmatter = "") {
	const dir = path.join(tmpDir, ".cline", "skills", name)
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(
		path.join(dir, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${name} skill\n${frontmatter}---\nDo ${name}.\n`,
	)
}

function createConfig(): TaskConfig {
	const settings: Record<string, unknown> = { mcpToolAvailability: "dynamic_declared_only", mode: "act" }
	return {
		cwd: tmpDir,
		taskId: "t1",
		ulid: "u1",
		isSubagentExecution: true,
		taskState: new TaskState(),
		api: { getModel: () => ({ id: "m" }) },
		callbacks: { say: sinon.stub().resolves() },
		services: {
			stateManager: {
				getRemoteConfigSettings: () => ({}),
				getGlobalSettingsKey: (k: string) => settings[k],
				getWorkspaceStateKey: () => ({}),
				getGlobalStateKey: () => ({}),
				getApiConfiguration: () => ({}),
			},
		},
	} as unknown as TaskConfig
}

const use = (h: UseSkillToolHandler, c: TaskConfig, name: string) =>
	h.execute(c, { name: "use_skill", params: { skill_name: name } } as any) as Promise<string>

describe("UseSkillToolHandler: multiple skills per task", () => {
	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-skill-"))
		persist = sinon.stub(policyModule, "persistSkillMcpPolicyState").resolves(true)
		await writeSkill("recall", "allowed_mcp_tools:\n  - srv:a\n  - srv:b\n")
		await writeSkill("audit", "allowed_mcp_tools:\n  - srv:c\n")
		await writeSkill("plain")
	})
	afterEach(async () => {
		sinon.restore()
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("loads A then B without the one-skill error and keeps both policies", async () => {
		const c = createConfig()
		const h = new UseSkillToolHandler()
		const a = await use(h, c, "recall")
		const b = await use(h, c, "audit")
		assert.ok(!a.startsWith("Error") && !b.startsWith("Error"), `${a}\n${b}`)
		assert.ok(!/Do NOT call use_skill again|Only one skill/.test(a + b))
		assert.deepEqual(
			c.taskState.loadedSkillMcpPolicies.map((p) => p.skillName),
			["recall", "audit"],
		)
	})

	it("plain skill after a declared one is accepted and does not remove the declared policy", async () => {
		const c = createConfig()
		const h = new UseSkillToolHandler()
		await use(h, c, "recall")
		await use(h, c, "plain")
		assert.equal(c.taskState.loadedSkillMcpPolicies.length, 2)
		assert.equal(c.taskState.loadedSkillMcpPolicies[0].allowed.length, 2)
	})

	it("repeat load is policy-idempotent: no duplicate entry, no extra metadata write, text still returned", async () => {
		const c = createConfig()
		const h = new UseSkillToolHandler()
		await use(h, c, "recall")
		const again = await use(h, c, "recall")
		assert.ok(again.includes("Do recall."))
		assert.equal(c.taskState.loadedSkillMcpPolicies.length, 1)
		assert.equal(persist.callCount, 1)
	})

	it("missing skill leaves the collection unchanged", async () => {
		const c = createConfig()
		const h = new UseSkillToolHandler()
		await use(h, c, "recall")
		const res = await use(h, c, "nope")
		assert.ok(res.startsWith("Error"))
		assert.deepEqual(
			c.taskState.loadedSkillMcpPolicies.map((p) => p.skillName),
			["recall"],
		)
		assert.equal(persist.callCount, 1)
	})

	it("concurrent A/B and duplicate A activations keep exactly one entry each", async () => {
		const c = createConfig()
		const h = new UseSkillToolHandler()
		await Promise.all([use(h, c, "recall"), use(h, c, "audit"), use(h, c, "recall")])
		assert.deepEqual(c.taskState.loadedSkillMcpPolicies.map((p) => p.skillName).sort(), ["audit", "recall"])
	})
})
