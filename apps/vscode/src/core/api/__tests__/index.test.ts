import "should"
import {
	type ApiConfiguration,
	clinePassDefaultModelId,
	clinePassModelInfoSaneDefaults,
	clinePassModels,
	type ModelInfo,
} from "@shared/api"
import type { Mode } from "@shared/storage/types"
import sinon from "sinon"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { buildApiHandler, resolveAwsBedrockUsePromptCache } from "../index"

describe("buildApiHandler", () => {
	beforeEach(() => {
		sinon.stub(ClineAccountService, "getInstance").returns({} as any)
		sinon.stub(AuthService, "getInstance").returns({} as any)
	})

	afterEach(() => {
		sinon.restore()
	})

	const buildClinePassHandler = (configuration: Partial<ApiConfiguration>, mode: Mode = "act") =>
		buildApiHandler(
			{
				planModeApiProvider: "cline-pass",
				actModeApiProvider: "cline-pass",
				...configuration,
			} as ApiConfiguration,
			mode,
		)

	describe("Bedrock prompt-cache mode selection", () => {
		const configuration = {
			awsBedrockUsePromptCache: false,
			planModeAwsBedrockUsePromptCache: true,
			actModeAwsBedrockUsePromptCache: false,
		} as ApiConfiguration

		it("uses only the shared value when Plan/Act models are not split", () => {
			resolveAwsBedrockUsePromptCache(configuration, "plan", false).should.equal(false)
			resolveAwsBedrockUsePromptCache(configuration, "act", false).should.equal(false)
		})

		it("uses only the Plan value in split Plan mode", () => {
			resolveAwsBedrockUsePromptCache(configuration, "plan", true).should.equal(true)
		})

		it("uses only the Act value in split Act mode", () => {
			resolveAwsBedrockUsePromptCache(configuration, "act", true).should.equal(false)
		})

		it("does not fall back to the shared value when a split-mode value is unset", () => {
			const unsetSplitValues = {
				awsBedrockUsePromptCache: true,
			} as ApiConfiguration
			;(resolveAwsBedrockUsePromptCache(unsetSplitValues, "plan", true) === undefined).should.equal(true)
			;(resolveAwsBedrockUsePromptCache(unsetSplitValues, "act", true) === undefined).should.equal(true)
		})
	})

	describe("cline-pass provider", () => {
		const freeModelInfo: ModelInfo = {
			...clinePassModelInfoSaneDefaults,
			maxTokens: 32_768,
			contextWindow: 256_000,
			description: "A free model",
		}

		it("passes a free (non cline-pass prefixed) model id through with its stored info", () => {
			const handler = buildClinePassHandler({
				actModeClinePassModelId: "kwaipilot/kat-coder-pro",
				actModeClinePassModelInfo: freeModelInfo,
			})

			const model = handler.getModel()
			model.id.should.equal("kwaipilot/kat-coder-pro")
			model.info.should.deepEqual(freeModelInfo)
		})

		it("passes a :free suffixed model id through with its stored info", () => {
			const handler = buildClinePassHandler({
				actModeClinePassModelId: "arcee-ai/trinity-large-preview:free",
				actModeClinePassModelInfo: freeModelInfo,
			})

			const model = handler.getModel()
			model.id.should.equal("arcee-ai/trinity-large-preview:free")
			model.info.should.deepEqual(freeModelInfo)
		})

		it("falls back to sane defaults for a free model id without stored info", () => {
			const handler = buildClinePassHandler({
				actModeClinePassModelId: "kwaipilot/kat-coder-pro",
			})

			const model = handler.getModel()
			model.id.should.equal("kwaipilot/kat-coder-pro")
			model.info.should.deepEqual(clinePassModelInfoSaneDefaults)
		})

		it("resolves cline-pass ids against the static model table", () => {
			const handler = buildClinePassHandler({
				actModeClinePassModelId: "cline-pass/glm-5.2",
			})

			const model = handler.getModel()
			model.id.should.equal("cline-pass/glm-5.2")
			model.info.should.deepEqual(clinePassModels["cline-pass/glm-5.2"])
		})

		it("falls back to the default pass model when no model id is configured", () => {
			const handler = buildClinePassHandler({})

			const model = handler.getModel()
			model.id.should.equal(clinePassDefaultModelId)
			model.info.should.deepEqual(clinePassModels[clinePassDefaultModelId])
		})

		it("resolves plan and act mode model ids independently", () => {
			const configuration: Partial<ApiConfiguration> = {
				planModeClinePassModelId: "kwaipilot/kat-coder-pro",
				planModeClinePassModelInfo: freeModelInfo,
				actModeClinePassModelId: "cline-pass/glm-5.2",
			}

			buildClinePassHandler(configuration, "plan").getModel().id.should.equal("kwaipilot/kat-coder-pro")
			buildClinePassHandler(configuration, "act").getModel().id.should.equal("cline-pass/glm-5.2")
		})
	})
})
