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

	it("ignores excluded directories and discovers repositories created later in the task", async () => {
		await fs.mkdir(path.join(workspacePath, "nested", ".git"), { recursive: true })
		await fs.mkdir(path.join(workspacePath, "venv", "nested", ".git"), { recursive: true })

		const operations = new GitOperations(workspacePath)
		await operations.renameNestedGitRepos(true)

		expect(await fs.stat(path.join(workspacePath, "nested", ".git_disabled"))).to.exist
		await expectMissing(path.join(workspacePath, "nested", ".git"))
		expect(await fs.stat(path.join(workspacePath, "venv", "nested", ".git"))).to.exist

		await operations.renameNestedGitRepos(false)
		await fs.mkdir(path.join(workspacePath, "later", ".git"), { recursive: true })
		await operations.renameNestedGitRepos(true)

		expect(await fs.stat(path.join(workspacePath, "nested", ".git_disabled"))).to.exist
		expect(await fs.stat(path.join(workspacePath, "later", ".git_disabled"))).to.exist
		await operations.renameNestedGitRepos(false)
	})

	it("makes restoration idempotent after partial success", async () => {
		await fs.mkdir(path.join(workspacePath, "first", ".git"), { recursive: true })
		await fs.mkdir(path.join(workspacePath, "second", ".git"), { recursive: true })

		const operations = new GitOperations(workspacePath)
		await operations.renameNestedGitRepos(true)

		await fs.rename(
			path.join(workspacePath, "first", ".git_disabled"),
			path.join(workspacePath, "first", ".git"),
		)
		await operations.renameNestedGitRepos(false)

		expect(await fs.stat(path.join(workspacePath, "first", ".git"))).to.exist
		expect(await fs.stat(path.join(workspacePath, "second", ".git"))).to.exist
		await expectMissing(path.join(workspacePath, "second", ".git_disabled"))
	})

	it("does not fail restoration when a disabled repository is removed", async () => {
		await fs.mkdir(path.join(workspacePath, "removed", ".git"), { recursive: true })

		const operations = new GitOperations(workspacePath)
		await operations.renameNestedGitRepos(true)
		await fs.rm(path.join(workspacePath, "removed", ".git_disabled"), { recursive: true, force: true })

		await operations.renameNestedGitRepos(false)
		await expectMissing(path.join(workspacePath, "removed", ".git_disabled"))
	})

	it("recovers disabled repositories inside newly excluded directories", async () => {
		await fs.mkdir(path.join(workspacePath, "venv", "nested", ".git_disabled"), { recursive: true })

		const operations = new GitOperations(workspacePath)
		await operations.renameNestedGitRepos(false)

		expect(await fs.stat(path.join(workspacePath, "venv", "nested", ".git"))).to.exist
		await expectMissing(path.join(workspacePath, "venv", "nested", ".git_disabled"))
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
