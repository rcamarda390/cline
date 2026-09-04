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
	// ts-proto generates `level` as `string` (proto3 optional-string default is "", not
	// undefined), so an empty level is falsy but not nullish — `??` alone wouldn't catch it.
	const logMethod = LOG_METHOD_BY_LEVEL[request.level] || LOG_METHOD_BY_LEVEL.LOG
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
