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
import { buildApiHandler, resolveOpenAiCompatibleApiKey, resolvePromptCachePreference } from "../index"

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
			true,
		)

	describe("prompt-cache preference selection", () => {
		const configuration = {
			usePromptCache: false,
			planModeUsePromptCache: true,
			actModeUsePromptCache: false,
		} as ApiConfiguration

		it("uses only the shared value when Plan/Act models are not split", () => {
			resolvePromptCachePreference(configuration, "plan", false, "bedrock")!.should.equal(false)
			resolvePromptCachePreference(configuration, "act", false, "anthropic")!.should.equal(false)
		})

		it("uses a dedicated Plan value when split", () => {
			resolvePromptCachePreference(configuration, "plan", true, "bedrock")!.should.equal(true)
		})

		it("uses a dedicated Act value when split", () => {
			resolvePromptCachePreference(configuration, "act", true, "bedrock")!.should.equal(false)
		})

		it("does not fall back from an unset split value to the shared generic value", () => {
			const unsetSplitValues = { usePromptCache: true } as ApiConfiguration
			;(resolvePromptCachePreference(unsetSplitValues, "plan", true, "bedrock") === undefined).should.equal(true)
			;(resolvePromptCachePreference(unsetSplitValues, "act", true, "bedrock") === undefined).should.equal(true)
		})

		it("retains legacy Bedrock values for upgrades until a generic value is written", () => {
			const legacy = {
				awsBedrockUsePromptCache: false,
				planModeAwsBedrockUsePromptCache: true,
				actModeAwsBedrockUsePromptCache: false,
			} as ApiConfiguration
			resolvePromptCachePreference(legacy, "plan", false, "bedrock")!.should.equal(false)
			resolvePromptCachePreference(legacy, "plan", true, "bedrock")!.should.equal(true)
			resolvePromptCachePreference(legacy, "act", true, "bedrock")!.should.equal(false)
		})

		it("preserves historical automatic caching defaults for controllable non-Bedrock providers", () => {
			const empty = {} as ApiConfiguration
			resolvePromptCachePreference(empty, "act", false, "anthropic")!.should.equal(true)
			resolvePromptCachePreference(empty, "act", false, "litellm")!.should.equal(true)
			resolvePromptCachePreference(empty, "act", false, "oca")!.should.equal(true)
			resolvePromptCachePreference(empty, "act", false, "vertex")!.should.equal(true)
		})
	})
	describe("OpenAI Compatible API key selection", () => {
		const configuration = {
			openAiApiKey: "legacy-key",
			planModeOpenAiApiKey: "plan-key",
			actModeOpenAiApiKey: "act-key",
		} as ApiConfiguration

		it("uses independent Plan and Act keys when model separation is enabled", () => {
			resolveOpenAiCompatibleApiKey(configuration, "plan", true)!.should.equal("plan-key")
			resolveOpenAiCompatibleApiKey(configuration, "act", true)!.should.equal("act-key")
		})

		it("keeps each mode independent when the other mode changes", () => {
			const changedPlan = { ...configuration, planModeOpenAiApiKey: "new-plan-key" }
			resolveOpenAiCompatibleApiKey(changedPlan, "act", true)!.should.equal("act-key")

			const changedAct = { ...configuration, actModeOpenAiApiKey: "new-act-key" }
			resolveOpenAiCompatibleApiKey(changedAct, "plan", true)!.should.equal("plan-key")
		})

		it("falls back to the legacy shared key until a mode-specific key is written", () => {
			const legacy = { openAiApiKey: "legacy-key" } as ApiConfiguration
			resolveOpenAiCompatibleApiKey(legacy, "plan", true)!.should.equal("legacy-key")
			resolveOpenAiCompatibleApiKey(legacy, "act", true)!.should.equal("legacy-key")
		})

		it("lets a mode-specific key override the legacy shared key", () => {
			const planOnly = { openAiApiKey: "legacy-key", planModeOpenAiApiKey: "plan-key" } as ApiConfiguration
			resolveOpenAiCompatibleApiKey(planOnly, "plan", true)!.should.equal("plan-key")
			resolveOpenAiCompatibleApiKey(planOnly, "act", true)!.should.equal("legacy-key")
		})

		it("preserves an explicit clear without resurrecting the legacy shared key", () => {
			const cleared = { openAiApiKey: "legacy-key", planModeOpenAiApiKey: "" } as ApiConfiguration
			resolveOpenAiCompatibleApiKey(cleared, "plan", true)!.should.equal("")
		})

		it("uses only the shared key when model separation is disabled", () => {
			resolveOpenAiCompatibleApiKey(configuration, "plan", false)!.should.equal("legacy-key")
			resolveOpenAiCompatibleApiKey(configuration, "act", false)!.should.equal("legacy-key")
		})

		it("does not select an OpenAI Compatible key for a mixed-provider mode", () => {
			const mixed = {
				...configuration,
				planModeApiProvider: "openai",
				actModeApiProvider: "bedrock",
			} as ApiConfiguration
			const actHandler = buildApiHandler(mixed, "act", true)
			actHandler.constructor.name.should.equal("AwsBedrockHandler")
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
