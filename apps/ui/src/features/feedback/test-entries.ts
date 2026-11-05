import type { SessionEntry } from '@/data/core';

// Minimal session entries, shaped like the chat's own fixtures.
export function promptEntry( text: string ): SessionEntry {
	return {
		type: 'custom',
		id: `prompt-${ text }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		customType: 'studio.user_prompt',
		data: { text, source: 'prompt' },
	} as SessionEntry;
}

export function assistantTextEntry( text: string ): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ text }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:02.000Z',
		message: { role: 'assistant', content: [ { type: 'text', text } ] },
	} as unknown as SessionEntry;
}

export function assistantToolCallEntry( name: string, args: Record< string, unknown > = {} ) {
	return {
		type: 'message',
		id: `assistant-${ name }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		message: {
			role: 'assistant',
			content: [ { type: 'toolCall', id: 'tool-call-1', name, arguments: args } ],
		},
	} as unknown as SessionEntry;
}

export function toolResultEntry( text: string, isError = false ): SessionEntry {
	return {
		type: 'message',
		id: 'tool-result',
		parentId: null,
		timestamp: '2026-06-05T12:00:01.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'tool-call-1',
			content: [ { type: 'text', text } ],
			isError,
		},
	} as unknown as SessionEntry;
}

export function turnClosedEntry( status: string ): SessionEntry {
	return {
		type: 'custom',
		id: `turn-closed-${ status }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:03.000Z',
		customType: 'studio.turn_closed',
		data: { status },
	} as SessionEntry;
}
