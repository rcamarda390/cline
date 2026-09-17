import { fileExistsAtPath } from "@utils/fs"
import { retryWithBackoff } from "@utils/retry"
import fs from "fs/promises"
import { globby } from "globby"
import * as path from "path"
import simpleGit, { type SimpleGit } from "simple-git"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { GIT_DISABLED_SUFFIX, getDefaultExclusions, getLfsPatterns, writeExcludesFile } from "./CheckpointExclusions"

interface CheckpointAddResult {
	success: boolean
}

/**
 * GitOperations Class
 *
 * Handles git-specific operations for Cline's Checkpoints system.
 *
 * Key responsibilities:
 * - Git repository initialization and configuration
 * - Git settings management (user, LFS, etc.)
 * - Worktree configuration and management
 * - Managing nested git repositories during checkpoint operations
 * - File staging and checkpoint creation
 * - Shadow git repository maintenance and cleanup
 */
export class GitOperations {
	private cwd: string
	private disabledNestedGitPaths = new Set<string>()
	private nestedGitDisableCycleActive = false

	/**
	 * Creates a new GitOperations instance.
	 *
	 * @param cwd - The current working directory for git operations
	 */
	constructor(cwd: string) {
		this.cwd = cwd
	}

	/**
	 * Initializes or verifies a shadow Git repository for checkpoint tracking.
	 * Creates a new repository if one doesn't exist, or verifies the worktree
	 * configuration if it does.
	 *
	 * Key operations:
	 * - Creates/verifies shadow git repository
	 * - Configures git settings (user, LFS, etc.)
	 * - Sets up worktree to point to workspace
	 *
	 * @param gitPath - Path to the .git directory
	 * @param cwd - The current working directory for git operations
	 * @returns Promise<string> Path to the initialized .git directory
	 * @throws Error if:
	 * - Worktree verification fails for existing repository
	 * - Git initialization or configuration fails
	 * - Unable to create initial commit
	 * - LFS pattern setup fails
	 */
	public async initShadowGit(gitPath: string, cwd: string, taskId: string): Promise<string> {
		Logger.info(`Initializing shadow git`)
		// Clean up any leftover .git_disabled directories from a previous crash/interruption.
		// If addCheckpointFiles() was interrupted mid disable/enable cycle, nested repos may still be disabled.
		await this.renameNestedGitRepos(false).catch((error) => {
			Logger.warn("CheckpointTracker failed best-effort nested git cleanup during shadow git init:", error)
		})

		// If repo exists, just verify worktree
		if (await fileExistsAtPath(gitPath)) {
			const git = simpleGit(path.dirname(gitPath))
			const worktree = await git.getConfig("core.worktree")
			if (worktree.value !== cwd) {
				throw new Error("Checkpoints can only be used in the original workspace: " + worktree.value)
			}
			Logger.warn(`Using existing shadow git at ${gitPath}`)

			// shadow git repo already exists, but update the excludes just in case
			await writeExcludesFile(gitPath, await getLfsPatterns(this.cwd))

			return gitPath
		}

		// Initialize new repo
		const startTime = performance.now()
		const checkpointsDir = path.dirname(gitPath)
		Logger.warn(`Creating new shadow git in ${checkpointsDir}`)

		const git = simpleGit(checkpointsDir)
		await git.init()

		// Configure repo with git settings
		await git.addConfig("core.worktree", cwd)
		await git.addConfig("commit.gpgSign", "false")
		await git.addConfig("user.name", "Cline Checkpoint")
		await git.addConfig("user.email", "checkpoint@cline.bot")

		// Set up LFS patterns
		const lfsPatterns = await getLfsPatterns(cwd)
		await writeExcludesFile(gitPath, lfsPatterns)

		const addFilesResult = await this.addCheckpointFiles(git)
		if (!addFilesResult.success) {
			Logger.error("Failed to add at least one file(s) to checkpoints shadow git")
			throw new Error("Failed to add at least one file(s) to checkpoints shadow git")
		}

		// Initial commit only on first repo creation
		await git.commit("initial commit", { "--allow-empty": null, "--no-verify": null })

		const durationMs = Math.round(performance.now() - startTime)
		telemetryService.captureCheckpointUsage(taskId, "shadow_git_initialized", durationMs)

		Logger.warn(`Shadow git initialization completed`)

		return gitPath
	}

	/**
	 * Retrieves the worktree path from the shadow git configuration.
	 * The worktree path indicates where the shadow git repository is tracking files,
	 * which should match the current workspace directory.
	 *
	 * @param gitPath - Path to the .git directory
	 * @returns Promise<string | undefined> The worktree path or undefined if not found
	 * @throws Error if unable to get worktree path
	 */
	public async getShadowGitConfigWorkTree(gitPath: string): Promise<string | undefined> {
		try {
			const git = simpleGit(path.dirname(gitPath))
			const worktree = await git.getConfig("core.worktree")
			return worktree.value || undefined
		} catch (error) {
			Logger.error("Failed to get shadow git config worktree:", error)
			return undefined
		}
	}

	/**
	 * Since we use git to track checkpoints, we need to temporarily disable nested git repos to work around git's
	 * requirement of using submodules for nested repos.
	 *
	 * This method renames nested .git directories by adding/removing a suffix to temporarily disable/enable them.
	 * The root .git directory is preserved. Uses VS Code's workspace API to find nested .git directories and
	 * only processes actual directories (not files named .git).
	 *
	 * @param disable - If true, adds suffix to disable nested git repos. If false, removes suffix to re-enable them.
	 * @throws Error if renaming any .git directory fails
	 */
	private async findNestedGitPaths(disabled: boolean): Promise<string[]> {
		// Normal checkpoint scans use the same exclusions as git add. Startup recovery deliberately
		// keeps the historical broad scope so an interrupted older version can restore repositories
		// inside directories that are now excluded from checkpoints.
		const ignore = disabled ? [".git", "**/node_modules/**"] : [".git", ...getDefaultExclusions()]
		return globby(`**/.git${disabled ? GIT_DISABLED_SUFFIX : ""}`, {
			cwd: this.cwd,
			onlyDirectories: true,
			ignore,
			dot: true,
			markDirectories: false,
			suppressErrors: true,
		})
	}

	public async renameNestedGitRepos(disable: boolean) {
		if (disable) {
			// Refresh once per checkpoint so repositories created or removed during a task are reconciled.
			// The discovered paths are then reused only for this disable/restore cycle.
			const gitPaths = await this.findNestedGitPaths(false)
			this.disabledNestedGitPaths.clear()
			this.nestedGitDisableCycleActive = true

			for (const gitPath of gitPaths) {
				const originalPath = path.join(this.cwd, gitPath)
				const disabledPath = originalPath + GIT_DISABLED_SUFFIX
				try {
					await fs.rename(originalPath, disabledPath)
					this.disabledNestedGitPaths.add(gitPath)
					Logger.log(`CheckpointTracker disabled nested git repo ${gitPath}`)
				} catch (error) {
					Logger.error(`CheckpointTracker failed to disable nested git repo ${gitPath}:`, error)
					throw new Error(
						`Failed to disable nested git repo ${gitPath}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}
			return
		}

		const gitPaths = this.nestedGitDisableCycleActive
			? [...this.disabledNestedGitPaths]
			: (await this.findNestedGitPaths(true)).map((gitPath) => gitPath.slice(0, -GIT_DISABLED_SUFFIX.length))

		for (const gitPath of gitPaths) {
			const originalPath = path.join(this.cwd, gitPath)
			const disabledPath = originalPath + GIT_DISABLED_SUFFIX
			try {
				await fs.rename(disabledPath, originalPath)
				this.disabledNestedGitPaths.delete(gitPath)
				Logger.log(`CheckpointTracker enabled nested git repo ${gitPath}`)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					// A prior retry may already have restored this path, or the repository may have
					// been removed. In either case there is nothing left disabled at this path.
					this.disabledNestedGitPaths.delete(gitPath)
					continue
				}
				Logger.error(`CheckpointTracker failed to enable nested git repo ${gitPath}:`, error)
				throw new Error(
					`Failed to enable nested git repo ${gitPath}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		if (this.nestedGitDisableCycleActive && this.disabledNestedGitPaths.size === 0) {
			this.nestedGitDisableCycleActive = false
		}
	}

	/**
	 * Adds files to the shadow git repository while handling nested git repos.
	 * Uses git commands to list files and stages them for commit.
	 * Respects .gitignore and handles LFS patterns.
	 *
	 * Process:
	 * 1. Updates exclude patterns from LFS config
	 * 2. Temporarily disables nested git repos
	 * 3. Gets list of tracked and untracked files from git (respecting .gitignore)
	 * 4. Adds all files to git staging
	 * 5. Re-enables nested git repos
	 *
	 * @param git - SimpleGit instance configured for the shadow git repo
	 * @returns Promise<CheckpointAddResult> Object containing success status, message, and file count
	 * @throws Error if:
	 *  - File operations fail
	 *  - Git commands error
	 *  - LFS pattern updates fail
	 *  - Nested git repo handling fails
	 */
	public async addCheckpointFiles(git: SimpleGit): Promise<CheckpointAddResult> {
		const startTime = performance.now()
		try {
			// Update exclude patterns before each commit
			await this.renameNestedGitRepos(true)
			Logger.info("Starting checkpoint add operation...")

			// Attempt to add all files. Any files with permissions errors will not be added,
			// but the process will proceed and add the rest (--ignore-errors).
			try {
				await git.add([".", "--ignore-errors"])
				const durationMs = Math.round(performance.now() - startTime)
				Logger.debug(`Checkpoint add operation completed in ${durationMs}ms`)
				return { success: true }
			} catch (_error) {
				return { success: false }
			}
		} catch (_error) {
			return { success: false }
		} finally {
			await retryWithBackoff(() => this.renameNestedGitRepos(false), {
				operationName: "CheckpointTracker re-enable nested git repos",
				maxAttempts: 3,
				baseDelayMs: 50,
				onRetry: (_error, attempt, maxAttempts, delayMs) => {
					Logger.warn(
						`CheckpointTracker re-enable nested git repos failed on attempt ${attempt}/${maxAttempts}. Retrying in ${delayMs}ms`,
					)
				},
			}).catch((error) => {
				Logger.error("CheckpointTracker failed to re-enable nested git repos after retries:", error)
			})
		}
	}
}

