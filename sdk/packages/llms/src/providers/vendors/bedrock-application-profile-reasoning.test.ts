import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
	bedrockAdaptiveProfileReasoningMiddleware,
	usesAdaptiveClaudeApplicationProfile,
} from "./bedrock-application-profile-reasoning";

const PROFILE_ARN =
	"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/profile-id";

async function transform(
	params: LanguageModelV4CallOptions,
): Promise<LanguageModelV4CallOptions> {
	const transformParams =
		bedrockAdaptiveProfileReasoningMiddleware.transformParams;
	if (!transformParams) {
		throw new Error(
			"Expected Bedrock reasoning middleware to transform params",
		);
	}
	return transformParams({
		params,
		model: {} as never,
	});
}

describe("Bedrock application-profile reasoning", () => {
	it("uses the configured base model only for application-profile ARNs", () => {
		expect(
			usesAdaptiveClaudeApplicationProfile(
				PROFILE_ARN,
				"anthropic.claude-sonnet-5",
			),
		).toBe(true);
		expect(
			usesAdaptiveClaudeApplicationProfile(
				"anthropic.claude-sonnet-4-6",
				"anthropic.claude-sonnet-5",
			),
		).toBe(false);
		expect(
			usesAdaptiveClaudeApplicationProfile(
				PROFILE_ARN,
				"anthropic.claude-3-7-sonnet-20250219-v1:0",
			),
		).toBe(false);
		expect(
			usesAdaptiveClaudeApplicationProfile(
				PROFILE_ARN,
				"anthropic.claude-future-model",
			),
		).toBe(true);
	});

	it("encodes portable reasoning as adaptive Claude fields", async () => {
		const result = await transform({
			prompt: [],
			reasoning: "medium",
			temperature: 0.2,
			topP: 0.8,
			topK: 20,
			providerOptions: {
				bedrock: {
					additionalModelRequestFields: { anthropic_beta: ["test-beta"] },
				},
			},
		});

		expect(result).toMatchObject({
			reasoning: undefined,
			temperature: undefined,
			topP: undefined,
			topK: undefined,
			providerOptions: {
				amazonBedrock: {
					additionalModelRequestFields: {
						anthropic_beta: ["test-beta"],
						thinking: { type: "adaptive" },
						output_config: { effort: "medium" },
					},
				},
			},
		});
	});

	it("maps portable xhigh effort to Bedrock max", async () => {
		const result = await transform({ prompt: [], reasoning: "xhigh" });
		expect(
			(
				result.providerOptions?.amazonBedrock
					?.additionalModelRequestFields as Record<string, unknown>
			).output_config,
		).toEqual({ effort: "max" });
	});

	it("maps portable minimal effort to Bedrock low", async () => {
		const result = await transform({ prompt: [], reasoning: "minimal" });
		expect(
			(
				result.providerOptions?.amazonBedrock
					?.additionalModelRequestFields as Record<string, unknown>
			).output_config,
		).toEqual({ effort: "low" });
	});

	it("leaves disabled reasoning unchanged", async () => {
		const params = {
			prompt: [],
			reasoning: "none",
			temperature: 0.2,
		} satisfies LanguageModelV4CallOptions;
		expect(await transform(params)).toBe(params);
	});
});
