const tsConfigPaths = require("tsconfig-paths")
const fs = require("fs")
const path = require("path")
const Module = require("module")

const baseUrl = path.resolve(__dirname)

const tsConfig = JSON.parse(fs.readFileSync(path.join(baseUrl, "tsconfig.json"), "utf-8"))

/**
 * The aliases point towards the `src` directory.
 * However, `tsc` doesn't compile paths by itself
 * (https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths-does-not-affect-emit)
 * So we need to use tsconfig-paths to resolve the aliases when running tests,
 * but pointing to `out` instead.
 */
const outPaths = {}
Object.keys(tsConfig.compilerOptions.paths).forEach((key) => {
	const value = tsConfig.compilerOptions.paths[key]
	outPaths[key] = value.map((path) => path.replace("src", "out/src"))
})

tsConfigPaths.register({
	baseUrl: baseUrl,
	paths: outPaths,
})

// Mock the @google/genai module to avoid ESM compatibility issues in tests
// The module is ES6 only, but the integration tests are compiled to commonJS.
const originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
	// Route bare ESM package imports to the CommonJS bundles produced by
	// build-tests.js for the VS Code 1.98.2 integration-test runtime.
	if (/^(?:@[a-z0-9-]+\/)?[a-z][a-z0-9-]*$/.test(id)) {
		const bundledPath = path.join(baseUrl, "out/packages", `${id}.js`)
		if (fs.existsSync(bundledPath)) {
			return originalRequire.call(this, bundledPath)
		}
	}
	// Intercept requires for @google/genai
	if (id === "@google/genai") {
		// Return the mock instead
		const mockPath = path.join(baseUrl, "out/src/core/api/providers/gemini-mock.test.js")
		return originalRequire.call(this, mockPath)
	}
	return originalRequire.call(this, id)
}
