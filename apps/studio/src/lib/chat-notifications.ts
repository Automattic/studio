import { BrowserWindow, Notification } from 'electron';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';

export interface ChatNotificationRequest {
	sessionId: string;
	title: string;
	body: string;
}

// Retained so click handlers aren't garbage-collected before the user
// interacts with the notification (notably on macOS). Keyed by session so a
// newer notification replaces a stale one for the same conversation.
const activeNotifications = new Map< string, Notification >();

export function showChatNotification(
	window: BrowserWindow | null,
	request: ChatNotificationRequest
): void {
	if ( ! Notification.isSupported() ) {
		return;
	}
	// No focus check here: the renderer only requests a notification when the
	// user isn't already looking at the conversation, and it may legitimately
	// want one while the window is focused on a different session.
	if ( ! window || window.isDestroyed() ) {
		return;
	}

	const { sessionId, title, body } = request;
	activeNotifications.get( sessionId )?.close();

	const notification = new Notification( { title, body, silent: true } );
	notification.on( 'click', () => {
		activeNotifications.delete( sessionId );
		if ( window.isDestroyed() ) {
			return;
		}
		window.show();
		if ( window.isMinimized() ) {
			window.restore();
		}
		window.focus();
		sendIpcEventToRendererWithWindow( window, 'chat-notification-clicked', { sessionId } );
	} );
	notification.on( 'close', () => activeNotifications.delete( sessionId ) );
	notification.on( 'failed', () => activeNotifications.delete( sessionId ) );

	try {
		notification.show();
		activeNotifications.set( sessionId, notification );
	} catch ( error ) {
		// Unsigned dev builds on macOS and desktops without a notification
		// server can reject the request — degrade silently.
		console.error( 'Failed to show chat notification', error );
	}
}
