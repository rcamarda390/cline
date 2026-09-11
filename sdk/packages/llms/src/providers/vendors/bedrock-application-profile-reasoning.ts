import type {
	JSONObject,
	LanguageModelV4CallOptions,
	LanguageModelV4Middleware,
} from "@ai-sdk/provider";
import { resolveClaudeThinkingEra } from "../model-facts";

const APPLICATION_INFERENCE_PROFILE_MARKER = ":application-inference-profile/";

function asRecord(value: unknown): JSONObject {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JSONObject)
		: {};
}

export function usesAdaptiveClaudeApplicationProfile(
	modelId: string,
	baseModelId: string | undefined,
): boolean {
	const thinkingEra = resolveClaudeThinkingEra(baseModelId);
	return (
		modelId.includes(APPLICATION_INFERENCE_PROFILE_MARKER) &&
		(thinkingEra === "adaptive" || thinkingEra === "unknown-claude")
	);
}

/**
 * Bedrock application inference-profile ARNs are opaque, so the AI SDK cannot
 * infer that the resource fronts an adaptive-thinking Claude model. Translate
 * portable reasoning at the model boundary while leaving the ARN unchanged for
 * invocation and signing.
 */
export const bedrockAdaptiveProfileReasoningMiddleware: LanguageModelV4Middleware =
	{
		specificationVersion: "v4",
		transformParams: async ({ params }) => {
			if (params.reasoning === undefined || params.reasoning === "none") {
				return params;
			}

			const providerOptions = asRecord(params.providerOptions);
			const bedrockOptions = {
				...asRecord(providerOptions.bedrock),
				...asRecord(providerOptions.amazonBedrock),
			};
			const additionalModelRequestFields = asRecord(
				bedrockOptions.additionalModelRequestFields,
			);
			const outputConfig = asRecord(additionalModelRequestFields.output_config);
			const effort =
				params.reasoning === "minimal"
					? "low"
					: params.reasoning === "xhigh"
						? "max"
						: params.reasoning;

			return {
				...params,
				// Prevent the provider from encoding the opaque ARN as a generic
				// Bedrock reasoningConfig request.
				reasoning: undefined,
				// Anthropic rejects sampling controls while thinking is enabled.
				temperature: undefined,
				topP: undefined,
				topK: undefined,
				providerOptions: {
					...providerOptions,
					amazonBedrock: {
						...bedrockOptions,
						additionalModelRequestFields: {
							...additionalModelRequestFields,
							thinking:
								additionalModelRequestFields.thinking ??
								({ type: "adaptive" } as const),
							output_config: {
								...outputConfig,
								effort: outputConfig.effort ?? effort,
							},
						},
					},
				},
			} satisfies LanguageModelV4CallOptions;
		},
	};
