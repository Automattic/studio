export const MESSAGE_SEND_SHORTCUTS = [ 'mod-enter', 'enter' ] as const;

export type MessageSendShortcut = ( typeof MESSAGE_SEND_SHORTCUTS )[ number ];

export const DEFAULT_MESSAGE_SEND_SHORTCUT: MessageSendShortcut = 'mod-enter';

export function isMessageSendShortcut( value: unknown ): value is MessageSendShortcut {
	return (
		typeof value === 'string' && ( MESSAGE_SEND_SHORTCUTS as readonly string[] ).includes( value )
	);
}
