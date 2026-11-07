import type { SessionEntry } from '@/data/core';

export function visualAnnotationsEntry(
	visualAnnotations: Array< {
		comment: string;
		tag?: string;
		elementLabel?: string;
		nearbyText?: string;
	} >
): SessionEntry {
	return {
		type: 'custom',
		id: 'visual-annotations',
		parentId: null,
		timestamp: '2026-06-05T12:00:03.000Z',
		customType: 'studio.user_prompt',
		data: {
			text: `${ visualAnnotations.length } annotations submitted`,
			source: 'prompt',
			visualAnnotations,
		},
	} as SessionEntry;
}

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

export function turnClosedEntry( status: string, errorMessage?: string ): SessionEntry {
	return {
		type: 'custom',
		id: `turn-closed-${ status }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:03.000Z',
		customType: 'studio.turn_closed',
		data: { status, ...( errorMessage !== undefined ? { errorMessage } : {} ) },
	} as SessionEntry;
}

export function assistantTextEntry( ...texts: string[] ): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ texts[ 0 ] }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:02.000Z',
		message: { role: 'assistant', content: texts.map( ( text ) => ( { type: 'text', text } ) ) },
	} as unknown as SessionEntry;
}

export function assistantToolCallEntry(
	name: string,
	args: Record< string, unknown > = {},
	text?: string
): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ name }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		message: {
			role: 'assistant',
			content: [
				...( text ? [ { type: 'text', text } ] : [] ),
				{
					type: 'toolCall',
					id: 'tool-call-1',
					name,
					arguments: args,
				},
			],
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

export function agentQuestionEntry(
	question: string,
	options: Array< string | { label: string; description: string } >,
	id = 'question',
	selectedLabel?: string
): SessionEntry {
	return {
		type: 'custom',
		id,
		parentId: null,
		timestamp: '2026-06-05T12:00:01.000Z',
		customType: 'studio.agent_question',
		data: {
			question,
			options: options.map( ( option ) =>
				typeof option === 'string' ? { label: option, description: '' } : option
			),
			...( selectedLabel ? { selectedLabel } : {} ),
		},
	} as SessionEntry;
}

export function askUserAnswerEntry( id: string, text: string ): SessionEntry {
	return {
		type: 'custom',
		id,
		parentId: null,
		timestamp: '2026-06-05T12:00:02.000Z',
		customType: 'studio.user_prompt',
		data: {
			text,
			source: 'ask_user',
		},
	} as SessionEntry;
}
