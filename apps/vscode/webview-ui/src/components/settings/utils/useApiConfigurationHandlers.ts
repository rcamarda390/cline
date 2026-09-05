import { ApiConfiguration } from "@shared/api"
import { UpdateApiConfigurationPartialRequest } from "@shared/proto/cline/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

export const buildApiConfigurationPartialRequest = (updates: Partial<ApiConfiguration>) =>
	UpdateApiConfigurationPartialRequest.create({
		apiConfiguration: convertApiConfigurationToProto(updates as ApiConfiguration),
		updateMask: Object.keys(updates),
	})

export const useApiConfigurationHandlers = () => {
	const { planActSeparateModelsSetting } = useExtensionState()

	/**
	 * Updates exactly one API configuration field.
	 *
	 * Uses the partial-update RPC so a stale webview snapshot cannot overwrite
	 * unrelated settings while switching Plan/Act settings tabs.
	 */
	const handleFieldChange = async <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
		await ModelsServiceClient.updateApiConfigurationPartial(
			buildApiConfigurationPartialRequest({
				[field]: value,
			} as Partial<ApiConfiguration>),
		)
	}

	/**
	 * Updates only the explicitly supplied API configuration fields.
	 *
	 * The field mask prevents unrelated Plan/Act/shared prompt-cache values from
	 * being carried in a stale full configuration snapshot.
	 */
	const handleFieldsChange = async (updates: Partial<ApiConfiguration>) => {
		await ModelsServiceClient.updateApiConfigurationPartial(buildApiConfigurationPartialRequest(updates))
	}

	const handleModeFieldChange = async <PlanK extends keyof ApiConfiguration, ActK extends keyof ApiConfiguration>(
		fieldPair: { plan: PlanK; act: ActK },
		value: ApiConfiguration[PlanK] & ApiConfiguration[ActK], // Intersection ensures value is compatible with both field types
		currentMode: Mode,
	) => {
		if (planActSeparateModelsSetting) {
			const targetField = fieldPair[currentMode]
			await handleFieldChange(targetField, value)
		} else {
			await handleFieldsChange({
				[fieldPair.plan]: value,
				[fieldPair.act]: value,
			})
		}
	}

	/**
	 * Updates multiple mode-specific fields in a single atomic operation.
	 *
	 * This prevents race conditions that can occur when making multiple separate
	 * handleModeFieldChange calls in rapid succession.
	 *
	 * @param fieldPairs - Object mapping keys to plan/act field pairs
	 * @param values - Object with values for each key
	 * @param currentMode - The current mode being targeted
	 */
	const handleModeFieldsChange = async <T extends Record<string, any>>(
		fieldPairs: { [K in keyof T]: { plan: keyof ApiConfiguration; act: keyof ApiConfiguration } },
		values: T,
		currentMode: Mode,
	) => {
		if (planActSeparateModelsSetting) {
			// Update only the current mode's fields
			const updates: Partial<ApiConfiguration> = {}
			Object.entries(fieldPairs).forEach(([key, { plan, act }]) => {
				const targetField = currentMode === "plan" ? plan : act
				updates[targetField] = values[key]
			})
			await handleFieldsChange(updates)
		} else {
			// Update both modes' fields
			const updates: Partial<ApiConfiguration> = {}
			Object.entries(fieldPairs).forEach(([key, { plan, act }]) => {
				updates[plan] = values[key]
				updates[act] = values[key]
			})
			await handleFieldsChange(updates)
		}
	}

	return { handleFieldChange, handleFieldsChange, handleModeFieldChange, handleModeFieldsChange }
}
