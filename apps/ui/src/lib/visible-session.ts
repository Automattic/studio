// Tracks which chat session is currently on screen, so the chat-notifications
// watcher can tell "the user is already looking at this conversation" apart
// from "the user is on another site or another app". A module singleton (not
// React state) because the only consumer reads it imperatively at
// notification-decision time.
let visibleSessionId: string | null = null;

export function setVisibleSessionId( sessionId: string | null ): void {
	visibleSessionId = sessionId;
}

export function getVisibleSessionId(): string | null {
	return visibleSessionId;
}
