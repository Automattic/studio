export interface DeskChatsSearch {
	chats?: boolean;
	newChat?: number;
}

function parseChatsSearch( value: unknown ) {
	return value === true || value === 'true' || value === '1' || value === 'open';
}

function parseNewChatSearch( value: unknown ) {
	const parsed = typeof value === 'number' ? value : Number( value );
	return Number.isFinite( parsed ) && parsed > 0 ? parsed : undefined;
}

export function validateDeskChatsSearch( search: Record< string, unknown > ): DeskChatsSearch {
	return {
		chats: parseChatsSearch( search.chats ) || undefined,
		newChat: parseNewChatSearch( search.newChat ),
	};
}
