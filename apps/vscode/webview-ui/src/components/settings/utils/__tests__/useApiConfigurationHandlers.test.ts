import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
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

describe("OpenAI Compatible mode-specific secret updates", () => {
	it("round-trips only the Plan API key", () => {
		const request = buildApiConfigurationPartialRequest({
			planModeOpenAiApiKey: "plan-key",
		})

		expect(request.updateMask).toEqual(["planModeOpenAiApiKey"])
		expect(request.apiConfiguration?.planModeOpenAiApiKey).toBe("plan-key")
		expect(request.apiConfiguration?.actModeOpenAiApiKey).toBeUndefined()
		expect(request.apiConfiguration?.openAiApiKey).toBeUndefined()
	})

	it("round-trips only the Act API key", () => {
		const request = buildApiConfigurationPartialRequest({
			actModeOpenAiApiKey: "act-key",
		})

		expect(request.updateMask).toEqual(["actModeOpenAiApiKey"])
		expect(request.apiConfiguration?.actModeOpenAiApiKey).toBe("act-key")
		expect(request.apiConfiguration?.planModeOpenAiApiKey).toBeUndefined()
		expect(request.apiConfiguration?.openAiApiKey).toBeUndefined()
	})

	it("round-trips an explicit clear as an empty string", () => {
		const request = buildApiConfigurationPartialRequest({
			planModeOpenAiApiKey: "",
		})

		expect(request.apiConfiguration?.planModeOpenAiApiKey).toBe("")
	})

	it("preserves both mode-specific API keys through protobuf conversion", () => {
		const request = buildApiConfigurationPartialRequest({
			planModeOpenAiApiKey: "plan-key",
			actModeOpenAiApiKey: "act-key",
		})
		const roundTripped = convertProtoToApiConfiguration(request.apiConfiguration!)

		expect(roundTripped.planModeOpenAiApiKey).toBe("plan-key")
		expect(roundTripped.actModeOpenAiApiKey).toBe("act-key")
	})
})
