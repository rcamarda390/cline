import { Empty } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { DebugLogRequest } from "@/shared/proto/index.host"

const CLINE_OUTPUT_CHANNEL = vscode.window.createOutputChannel("Cline", { log: true })

// Maps Cline's Logger levels onto LogOutputChannel's methods. LogOutputChannel has no
// dedicated "log" level, so LOG (Logger.log, the general-purpose call) maps to info.
const LOG_METHOD_BY_LEVEL: Record<string, (message: string) => void> = {
	ERROR: (message) => CLINE_OUTPUT_CHANNEL.error(message),
	WARN: (message) => CLINE_OUTPUT_CHANNEL.warn(message),
	LOG: (message) => CLINE_OUTPUT_CHANNEL.info(message),
	INFO: (message) => CLINE_OUTPUT_CHANNEL.info(message),
	DEBUG: (message) => CLINE_OUTPUT_CHANNEL.debug(message),
	TRACE: (message) => CLINE_OUTPUT_CHANNEL.trace(message),
}

// Appends a log message to all Cline output channels.
export async function debugLog(request: DebugLogRequest): Promise<Empty> {
	// `level` is proto3 `optional string`, so ts-proto types it `string | undefined` — an
	// absent level (e.g. a caller that predates this field). Fall back to LOG for that, and
	// again if `level` is set to something outside LOG_METHOD_BY_LEVEL's known keys.
	const logMethod = LOG_METHOD_BY_LEVEL[request.level ?? "LOG"] ?? LOG_METHOD_BY_LEVEL.LOG
	// `request.value` is the raw message only (no timestamp/level prefix — Logger.ts stopped
	// adding one). LogOutputChannel prepends its own timestamp + level per line, so passing the
	// already-decorated string here would double it up.
	logMethod(request.value)
	return Empty.create({})
}

// Register the Cline output channel within the VSCode extension context.
export function registerClineOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(CLINE_OUTPUT_CHANNEL)
	return CLINE_OUTPUT_CHANNEL
}
