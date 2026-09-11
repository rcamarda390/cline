import type {
	LanguageModelV4,
	LanguageModelV4CallOptions,
	LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createBedrockProviderModule } from "./bedrock";

const PROFILE_ARN =
	"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/profile-id";

function userText(text: string): LanguageModelV4Prompt {
	return [{ role: "user", content: [{ type: "text", text }] }];
}

describe("Bedrock wire contract (real provider package)", () => {
	it("uses adaptive Claude reasoning for an application-profile ARN", async () => {
		let requestUrl: string | undefined;
		let requestBody: Record<string, unknown> | undefined;
		const fetchStub = (async (input, init) => {
			requestUrl = input instanceof Request ? input.url : input.toString();
			requestBody = JSON.parse(String(init?.body));
			return new Response(
				JSON.stringify({
					output: {
						message: {
							role: "assistant",
							content: [{ text: "OK" }],
						},
					},
					stopReason: "end_turn",
					usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
					metrics: { latencyMs: 1 },
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as typeof fetch;

		const module = await createBedrockProviderModule({
			providerId: "bedrock",
			apiKey: "test-api-key",
			fetch: fetchStub,
			options: {
				region: "us-east-1",
				customModelBaseId: "anthropic.claude-sonnet-5",
			},
		} as GatewayResolvedProviderConfig);
		const model = module.operations.language(PROFILE_ARN) as LanguageModelV4;
		await model.doGenerate({
			prompt: userText("hello"),
			maxOutputTokens: 1024,
			reasoning: "medium",
			temperature: 0.2,
		} as LanguageModelV4CallOptions);

		expect(requestUrl).toContain(encodeURIComponent(PROFILE_ARN));
		expect(requestBody).toMatchObject({
			additionalModelRequestFields: {
				thinking: { type: "adaptive" },
				output_config: { effort: "medium" },
			},
			inferenceConfig: { maxTokens: 1024 },
		});
		expect(requestBody?.additionalModelRequestFields).not.toHaveProperty(
			"reasoningConfig",
		);
		expect(requestBody?.inferenceConfig).not.toHaveProperty("temperature");
	});
});
