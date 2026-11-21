import { AskResponseRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useRef, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

interface MultiSelectOptionsProps {
	id: string
	isActive: boolean
	options: string[]
	selectedOptions?: string[]
}

export function MultiSelectOptions({ id, isActive, options, selectedOptions }: MultiSelectOptionsProps) {
	const [checked, setChecked] = useState<number[]>([])
	const [sending, setSending] = useState(false)
	const [error, setError] = useState(false)
	const submissionStarted = useRef(false)
	const disabled = !isActive || sending || Boolean(selectedOptions)

	async function submit() {
		if (disabled || submissionStarted.current || checked.length === 0) {
			return
		}

		submissionStarted.current = true
		setSending(true)
		setError(false)
		try {
			await TaskServiceClient.askResponse(
				AskResponseRequest.create({
					responseType: "multiSelectResponse",
					text: JSON.stringify({ id, indices: checked }),
				}),
			)
		} catch {
			submissionStarted.current = false
			setSending(false)
			setError(true)
		}
	}

	return (
		<fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
			<legend className="mb-2">Select all that apply</legend>
			{options.map((option, index) => (
				<label className="flex items-start gap-2" key={option}>
					<input
						checked={selectedOptions?.includes(option) ?? checked.includes(index)}
						disabled={disabled}
						onChange={(event) => {
							const isChecked = event.currentTarget.checked
							setChecked((previous) => (isChecked ? [...previous, index] : previous.filter((value) => value !== index)))
						}}
						type="checkbox"
					/>
					<span className="ph-no-capture">{option}</span>
				</label>
			))}
			{isActive && !selectedOptions && (
				<VSCodeButton className="self-start" disabled={disabled || checked.length === 0} onClick={submit}>
					{sending ? "Submitting…" : "Submit"}
				</VSCodeButton>
			)}
			{error && <span role="alert">Could not submit your selections.</span>}
		</fieldset>
	)
}
