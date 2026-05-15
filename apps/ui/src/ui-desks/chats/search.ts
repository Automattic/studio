export interface ChatsSearch {
	chats?: boolean;
	newChat?: number;
	session?: string;
}

function parseChatsSearch( value: unknown ) {
	return value === true || value === 'true' || value === '1' || value === 'open';
}

function parseNewChatSearch( value: unknown ) {
	const parsed = typeof value === 'number' ? value : Number( value );
	return Number.isFinite( parsed ) && parsed > 0 ? parsed : undefined;
}

export function validateChatsSearch( search: Record< string, unknown > ): ChatsSearch {
	return {
		chats: parseChatsSearch( search.chats ) || undefined,
		newChat: parseNewChatSearch( search.newChat ),
		session: typeof search.session === 'string' && search.session ? search.session : undefined,
	};
}
