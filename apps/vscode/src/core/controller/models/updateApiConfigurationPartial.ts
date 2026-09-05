import { buildApiHandler } from "@core/api"
import type { ApiConfiguration } from "@shared/api"
import { Empty } from "@shared/proto/cline/common"
import { UpdateApiConfigurationPartialRequest } from "@shared/proto/cline/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { clearOrganizationForClinePassProviderSelection } from "./handleClinePassProviderSelection"

/**
 * Updates API configuration with partial values using FieldMask
 *
 * Allows clients to update individual API configuration fields without
 * overwriting the entire configuration. Only fields specified in the update_mask
 * are updated from api_configuration.
 *
 * @param controller The controller instance
 * @param request The partial update API configuration request with FieldMask
 * @returns Empty response
 */
export async function updateApiConfigurationPartial(
	controller: Controller,
	request: UpdateApiConfigurationPartialRequest,
): Promise<Empty> {
	try {
		// Validate request
		if (!request.updateMask || request.updateMask.length === 0) {
			throw new Error("update_mask is required and must contain at least one field")
		}

		if (!request.apiConfiguration) {
			throw new Error("api_configuration is required")
		}

		// Convert request values, then persist only fields explicitly named by the mask.
		// Do not re-save a reconstructed full configuration: that can copy stale
		// Plan/Act values over independent settings.
		const newConfigValues = convertProtoToApiConfiguration(request.apiConfiguration)
		const partialUpdates: Partial<ApiConfiguration> = {}
		for (const field of request.updateMask) {
			;(partialUpdates as Record<string, any>)[field] = (newConfigValues as Record<string, any>)[field]
		}

		controller.stateManager.setApiConfiguration(partialUpdates as ApiConfiguration)
		const updatedConfig = controller.stateManager.getApiConfiguration()
		await clearOrganizationForClinePassProviderSelection(controller, updatedConfig)
		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			controller.task.api = buildApiHandler(
				{ ...updatedConfig, ulid: controller.task.ulid },
				currentMode,
				controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting"),
			)
		}

		// Notify webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to update API configuration (partial): ${error}`)
		throw error
	}
}
