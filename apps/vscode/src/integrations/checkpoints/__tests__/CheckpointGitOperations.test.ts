import fs from "fs/promises"
import os from "os"
import path from "path"
import { expect } from "chai"
import { GitOperations } from "../CheckpointGitOperations"

describe("GitOperations.renameNestedGitRepos", () => {
	let workspacePath: string

	beforeEach(async () => {
		workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "cline-checkpoints-"))
	})

	afterEach(async () => {
		await fs.rm(workspacePath, { recursive: true, force: true })
	})

	it("ignores excluded directories and reuses the nested-repository scan", async () => {
		await fs.mkdir(path.join(workspacePath, "nested", ".git"), { recursive: true })
		await fs.mkdir(path.join(workspacePath, "venv", "nested", ".git"), { recursive: true })

		const operations = new GitOperations(workspacePath)
		await operations.renameNestedGitRepos(true)

		expect(await fs.stat(path.join(workspacePath, "nested", ".git_disabled"))).to.exist
		await expectMissing(path.join(workspacePath, "nested", ".git"))
		expect(await fs.stat(path.join(workspacePath, "venv", "nested", ".git"))).to.exist

		await operations.renameNestedGitRepos(false)

		expect(await fs.stat(path.join(workspacePath, "nested", ".git"))).to.exist
		await expectMissing(path.join(workspacePath, "nested", ".git_disabled"))

		await fs.mkdir(path.join(workspacePath, "later", ".git"), { recursive: true })
		await operations.renameNestedGitRepos(true)

		expect(await fs.stat(path.join(workspacePath, "nested", ".git_disabled"))).to.exist
		expect(await fs.stat(path.join(workspacePath, "later", ".git"))).to.exist
		await operations.renameNestedGitRepos(false)
	})

	async function expectMissing(filePath: string): Promise<void> {
		try {
			await fs.stat(filePath)
			throw new Error(`Expected ${filePath} to be absent`)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error
			}
		}
	}
})
