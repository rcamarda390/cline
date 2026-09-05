#!/usr/bin/env node
const { execSync } = require("child_process")
const { pathToFileURL } = require("url")
const esbuild = require("esbuild")

const watch = process.argv.includes("--watch")

// VS Code 1.98.2's extension host cannot require these ESM-only packages from
// the CommonJS integration-test output. Production already bundles them.
const esmTestPackages = [
	"execa",
	"default-shell",
	"get-folder-size",
	"globby",
	"nanoid",
	"open",
	"os-name",
	"p-mutex",
	"p-timeout",
	"p-wait-for",
	"serialize-error",
	"strip-ansi",
	"chrome-launcher",
]

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: "esbuild-problem-matcher",

	setup(build) {
		build.onStart(() => {
			console.log("[watch] build started")
		})
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`)
				console.error(`    ${location.file}:${location.line}:${location.column}:`)
			})
			console.log("[watch] build finished")
		})
	},
}

const srcConfig = {
	bundle: true,
	minify: false,
	sourcemap: true,
	sourcesContent: true,
	logLevel: "silent",
	entryPoints: ["src/packages/**/*.ts"],
	outdir: "out/packages",
	format: "cjs",
	platform: "node",
	define: {
		"process.env.IS_TEST": "true",
	},
	external: ["vscode"],
	plugins: [esbuildProblemMatcherPlugin],
}

async function main() {
	await Promise.all(
		esmTestPackages.map((name) =>
			esbuild.build({
				...srcConfig,
				entryPoints: [require.resolve(name)],
				outdir: undefined,
				outfile: `out/packages/${name}.js`,
				define: {
					...srcConfig.define,
					// Preserve package-relative asset lookup, such as open's xdg-open script.
					"import.meta.url": JSON.stringify(pathToFileURL(require.resolve(name)).href),
				},
			}),
		),
	)
	const srcCtx = await esbuild.context(srcConfig)

	if (watch) {
		await srcCtx.watch()
	} else {
		await srcCtx.rebuild()

		await srcCtx.dispose()
	}
}

execSync("tsc -p ./tsconfig.test.json --outDir out", { encoding: "utf-8" })

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
