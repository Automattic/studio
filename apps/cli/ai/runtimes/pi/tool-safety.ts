import { type AgentTool } from '@mariozechner/pi-agent-core';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';

// Keep individual model-generated tool payloads below the range where long
// strings have been observed to arrive incomplete.
export const STUDIO_FILE_TOOL_MAX_BYTES = 14 * 1024;
export const STUDIO_BASH_COMMAND_MAX_BYTES = 8 * 1024;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;

const SIDE_EFFECTING_TOOL_NAMES = new Set( [ 'Write', 'Edit', 'Bash' ] );

export interface StudioToolPayloadGuardState {
	incompleteSideEffectingToolCallReason?: string;
}

function getByteLength( value: string ): number {
	return Buffer.byteLength( value, 'utf8' );
}

function formatBytes( bytes: number ): string {
	return `${ bytes } bytes`;
}

function getStringParam( params: unknown, key: string ): string | undefined {
	if ( ! params || typeof params !== 'object' ) {
		return undefined;
	}
	const value = ( params as Record< string, unknown > )[ key ];
	return typeof value === 'string' ? value : undefined;
}

function createPayloadLimitMessage(
	toolName: string,
	fieldName: string,
	actualBytes: number,
	maxBytes: number
): string {
	const nextStep =
		toolName === 'Bash'
			? 'Split the work into smaller Write/Edit calls. Do not retry with Bash heredocs or Python scripts; they carry the same large payload risk.'
			: 'Write a small skeleton and fill it with smaller Edit calls. Do not retry with Bash heredocs or Python scripts; they carry the same large payload risk.';

	return `${ toolName } ${ fieldName } is ${ formatBytes(
		actualBytes
	) }, exceeding Studio's ${ formatBytes( maxBytes ) } single-call safety limit. ${ nextStep }`;
}

function getPayloadLimitViolation( toolName: string, params: unknown ): string | undefined {
	if ( toolName === 'Write' ) {
		const content = getStringParam( params, 'content' );
		const bytes = content ? getByteLength( content ) : 0;
		if ( bytes > STUDIO_FILE_TOOL_MAX_BYTES ) {
			return createPayloadLimitMessage( toolName, 'content', bytes, STUDIO_FILE_TOOL_MAX_BYTES );
		}
	}

	if ( toolName === 'Edit' ) {
		for ( const fieldName of [ 'old_string', 'new_string' ] ) {
			const value = getStringParam( params, fieldName );
			const bytes = value ? getByteLength( value ) : 0;
			if ( bytes > STUDIO_FILE_TOOL_MAX_BYTES ) {
				return createPayloadLimitMessage( toolName, fieldName, bytes, STUDIO_FILE_TOOL_MAX_BYTES );
			}
		}
	}

	if ( toolName === 'Bash' ) {
		const command = getStringParam( params, 'command' );
		const bytes = command ? getByteLength( command ) : 0;
		if ( bytes > STUDIO_BASH_COMMAND_MAX_BYTES ) {
			return createPayloadLimitMessage( toolName, 'command', bytes, STUDIO_BASH_COMMAND_MAX_BYTES );
		}
	}

	return undefined;
}

function getToolCallNames( content: unknown ): string[] {
	if ( ! Array.isArray( content ) ) {
		return [];
	}
	return content.flatMap( ( block ) => {
		if ( ! block || typeof block !== 'object' ) {
			return [];
		}
		const item = block as Record< string, unknown >;
		return item.type === 'toolCall' && typeof item.name === 'string' ? [ item.name ] : [];
	} );
}

export function updateStudioToolPayloadGuardState(
	event: AgentSessionEvent,
	state: StudioToolPayloadGuardState
): void {
	if ( event.type !== 'message_end' || event.message.role !== 'assistant' ) {
		return;
	}

	const toolCallNames = getToolCallNames( event.message.content );
	const sideEffectingToolCallNames = toolCallNames.filter( ( name ) =>
		SIDE_EFFECTING_TOOL_NAMES.has( name )
	);

	if ( event.message.stopReason === 'length' && sideEffectingToolCallNames.length > 0 ) {
		state.incompleteSideEffectingToolCallReason = `Refusing to run ${ sideEffectingToolCallNames.join(
			', '
		) } because the assistant response hit the model output limit while generating tool arguments. The arguments may be partial even if they parse as JSON. Retry with a small skeleton and smaller Edit calls; do not use Bash heredocs or Python scripts.`;
		return;
	}

	state.incompleteSideEffectingToolCallReason = undefined;
}

function getPayloadLimitDescription( toolName: string, description: string ): string {
	if ( toolName === 'Write' || toolName === 'Edit' ) {
		return `${ description }\n\nStudio safety: keep generated file payloads at or below ${ formatBytes(
			STUDIO_FILE_TOOL_MAX_BYTES
		) } per call. For larger files, write a small skeleton and fill it with smaller Edit calls. Do not use Bash heredocs or Python scripts as a workaround.`;
	}

	if ( toolName === 'Bash' ) {
		return `${ description }\n\nStudio safety: commands longer than ${ formatBytes(
			STUDIO_BASH_COMMAND_MAX_BYTES
		) } are rejected. Do not use Bash heredocs or Python scripts to write large generated files; use smaller Write/Edit calls instead.`;
	}

	return description;
}

export function withStudioToolPayloadGuard(
	tool: AgentToolAny,
	state?: StudioToolPayloadGuardState
): AgentToolAny {
	return {
		...tool,
		description: getPayloadLimitDescription( tool.name, tool.description ),
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			if (
				state?.incompleteSideEffectingToolCallReason &&
				SIDE_EFFECTING_TOOL_NAMES.has( tool.name )
			) {
				throw new Error( state.incompleteSideEffectingToolCallReason );
			}

			const violation = getPayloadLimitViolation( tool.name, params );
			if ( violation ) {
				throw new Error( violation );
			}
			return tool.execute( toolCallId, params, signal, onUpdate );
		},
	};
}
