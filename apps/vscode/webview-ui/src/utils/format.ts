import prettyBytes from "pretty-bytes"

export function formatLargeNumber(num: number): string {
	if (num >= 1e9) {
		return (num / 1e9).toFixed(1) + "b"
	}
	if (num >= 1e6) {
		return (num / 1e6).toFixed(1) + "m"
	}
	if (num >= 1e3) {
		return (num / 1e3).toFixed(1) + "k"
	}
	return num.toString()
}

// Helper to format cents as dollars with 2 decimal places
export function formatDollars(cents?: number): string {
	if (cents === undefined) {
		return ""
	}

	return (cents / 100).toFixed(2)
}

/**
 * Converts microcredits to credits for display purposes.
 *
 * The backend stores credit balances in microcredits (1 credit = 10,000 microcredits)
 * to avoid floating point precision issues when performing calculations.
 * This function converts the microcredits back to the user-facing credit amount.
 *
 * @param microcredits - The balance in microcredits from the backend
 * @returns The balance in credits (typically displayed with 4 decimal places)
 *
 * @example
 * formatCreditsBalance(50000) // returns 5.0000 (credits)
 * formatCreditsBalance(12345) // returns 1.2345 (credits)
 */
export function formatCreditsBalance(microcredits: number): number {
	return microcredits / 10000
}

export function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp)

	const dateFormatter = new Intl.DateTimeFormat("en-US", {
		month: "2-digit",
		day: "2-digit",
		year: "2-digit",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	})

	return dateFormatter.format(date)
}

export function formatSize(bytes?: number) {
	if (bytes === undefined) {
		return "--kb"
	}

	return prettyBytes(bytes)
}
export function formatSeconds(seconds?: number): string {
	if (seconds === undefined) {
		return "--:--"
	}

	const mins = Math.floor(seconds / 60)
	const secs = Math.floor(seconds % 60)
		.toString()
		.padStart(2, "0")

	return `${mins}:${secs}`
}

/**
 * Prepends a journal header to copied text so the source window and task are visible on paste.
 * Uses the copy-time local wall clock with its UTC offset.
 */
export function withJournalId(text: string, taskId: string | undefined, enabled: boolean | undefined): string {
	if (!enabled || !taskId) {
		return text
	}

	const now = new Date()
	const offset = -now.getTimezoneOffset()
	const abs = Math.abs(offset)
	const local = new Date(now.getTime() + offset * 60000).toISOString().slice(0, 16).replace("T", " ")
	const tz = `UTC${offset < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`
	return `[src=ext | task=${taskId.slice(0, 8)} | ${local} ${tz}]\n${text}`
}
