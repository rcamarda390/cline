import { describe, expect, it } from "vitest"
import { buildApiConfigurationPartialRequest } from "../useApiConfigurationHandlers"

describe("provider-neutral prompt-cache partial API updates", () => {
	it("updates only the shared non-split prompt-cache field", () => {
		const request = buildApiConfigurationPartialRequest({
			usePromptCache: false,
		})

		expect(request.updateMask).toEqual(["usePromptCache"])
		expect(request.apiConfiguration?.usePromptCache).toBe(false)
		expect(request.apiConfiguration?.planModeUsePromptCache).toBeUndefined()
		expect(request.apiConfiguration?.actModeUsePromptCache).toBeUndefined()
	})

	it("updates only the Plan prompt-cache field", () => {
		const request = buildApiConfigurationPartialRequest({
			planModeUsePromptCache: true,
		})

		expect(request.updateMask).toEqual(["planModeUsePromptCache"])
		expect(request.apiConfiguration?.planModeUsePromptCache).toBe(true)
		expect(request.apiConfiguration?.usePromptCache).toBeUndefined()
		expect(request.apiConfiguration?.actModeUsePromptCache).toBeUndefined()
	})

	it("updates only the Act prompt-cache field", () => {
		const request = buildApiConfigurationPartialRequest({
			actModeUsePromptCache: true,
		})

		expect(request.updateMask).toEqual(["actModeUsePromptCache"])
		expect(request.apiConfiguration?.actModeUsePromptCache).toBe(true)
		expect(request.apiConfiguration?.usePromptCache).toBeUndefined()
		expect(request.apiConfiguration?.planModeUsePromptCache).toBeUndefined()
	})
})
