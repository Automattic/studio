import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// A finished tool call's result as the eval records it.
export function extractToolResult( event: AgentSessionEvent ): {
	toolUseId: string;
	isError: boolean;
	text?: string;
	images?: Array< { mimeType: string; data: string } >;
	details?: unknown;
} | null {
	if ( event.type !== 'tool_execution_end' ) {
		return null;
	}
	const result = event.result as
		| {
				content?: Array< { type: string; text?: string; data?: string; mimeType?: string } >;
				details?: unknown;
		  }
		| undefined;
	let text: string | undefined;
	let images: Array< { mimeType: string; data: string } > | undefined;
	if ( result?.content && Array.isArray( result.content ) ) {
		// Every text block, as the model reads them: Studio's notes follow the
		// tool's own output in a block of their own.
		const textBlocks = result.content.filter(
			( b ): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string'
		);
		if ( textBlocks.length ) text = textBlocks.map( ( b ) => b.text ).join( '\n' );
		const imageBlocks = result.content.filter(
			( b ): b is { type: 'image'; data: string; mimeType?: string } =>
				b.type === 'image' && typeof b.data === 'string'
		);
		if ( imageBlocks.length > 0 ) {
			images = imageBlocks.map( ( b ) => ( { mimeType: b.mimeType ?? '', data: b.data } ) );
		}
	}
	return {
		toolUseId: event.toolCallId,
		isError: event.isError,
		text,
		images,
		details: result?.details,
	};
}
