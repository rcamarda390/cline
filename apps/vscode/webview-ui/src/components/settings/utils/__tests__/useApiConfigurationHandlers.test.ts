import { describe, expect, it } from "vitest"
import { buildApiConfigurationPartialRequest } from "../useApiConfigurationHandlers"

describe("prompt-cache partial API updates", () => {
	it("updates only the shared non-split prompt-cache field", () => {
		const request = buildApiConfigurationPartialRequest({
			awsBedrockUsePromptCache: false,
		})

		expect(request.updateMask).toEqual(["awsBedrockUsePromptCache"])
		expect(request.apiConfiguration?.awsBedrockUsePromptCache).toBe(false)
		expect(request.apiConfiguration?.planModeAwsBedrockUsePromptCache).toBeUndefined()
		expect(request.apiConfiguration?.actModeAwsBedrockUsePromptCache).toBeUndefined()
	})

	it("updates only the Plan prompt-cache field", () => {
		const request = buildApiConfigurationPartialRequest({
			planModeAwsBedrockUsePromptCache: true,
		})

		expect(request.updateMask).toEqual(["planModeAwsBedrockUsePromptCache"])
		expect(request.apiConfiguration?.planModeAwsBedrockUsePromptCache).toBe(true)
		expect(request.apiConfiguration?.awsBedrockUsePromptCache).toBeUndefined()
		expect(request.apiConfiguration?.actModeAwsBedrockUsePromptCache).toBeUndefined()
	})

	it("updates only the Act prompt-cache field", () => {
		const request = buildApiConfigurationPartialRequest({
			actModeAwsBedrockUsePromptCache: true,
		})

		expect(request.updateMask).toEqual(["actModeAwsBedrockUsePromptCache"])
		expect(request.apiConfiguration?.actModeAwsBedrockUsePromptCache).toBe(true)
		expect(request.apiConfiguration?.awsBedrockUsePromptCache).toBeUndefined()
		expect(request.apiConfiguration?.planModeAwsBedrockUsePromptCache).toBeUndefined()
	})
})
