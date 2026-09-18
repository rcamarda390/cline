import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useDebouncedInput } from "../utils/useDebouncedInput"

/**
 * Masks a value, leaving only the last 4 characters visible (e.g. "••••••••abcd").
 * Short values (<= 4 chars) are masked entirely to avoid revealing the whole key.
 */
function maskApiKey(value: string): string {
	if (value.length <= 4) {
		return "•".repeat(value.length)
	}
	return "•".repeat(value.length - 4) + value.slice(-4)
}

/**
 * Props for the ApiKeyField component
 */
interface ApiKeyFieldProps {
	initialValue: string
	onChange: (value: string) => void
	providerName: string
	signupUrl?: string
	placeholder?: string
	helpText?: string
}

/**
 * A reusable component for API key input fields with standard styling and help text for signing up for key
 */
export const ApiKeyField = ({
	initialValue,
	onChange,
	providerName,
	signupUrl,
	placeholder = "Enter API Key...",
	helpText,
}: ApiKeyFieldProps) => {
	const [localValue, setLocalValue] = useDebouncedInput(initialValue, onChange)
	const [isFocused, setIsFocused] = useState(false)

	// While editing, show the real value so the user can type/paste normally.
	// Once unfocused, mask everything but the last 4 characters so a saved key stays identifiable.
	const displayValue = isFocused ? localValue : maskApiKey(localValue)

	return (
		<div>
			<VSCodeTextField
				onBlur={() => setIsFocused(false)}
				onFocus={() => setIsFocused(true)}
				onInput={(e: any) => setLocalValue(e.target.value)}
				placeholder={placeholder}
				required={true}
				style={{ width: "100%" }}
				type="text"
				value={displayValue}>
				<span style={{ fontWeight: 500 }}>{providerName} API Key</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{helpText || "This key is stored locally and only used to make API requests from this extension."}
				{!localValue && signupUrl && (
					<VSCodeLink
						href={signupUrl}
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get a{/^[aeiou]/i.test(providerName) ? "n" : ""} {providerName} API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}
