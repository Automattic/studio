import { __, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, Tooltip } from '@wordpress/ui';
import { useEffect } from 'react';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

const NEW_CHAT_SHORTCUT_KEY = 'n';

export function getSessionTitle( session: AiSessionSummary ): string {
	return session.firstPrompt?.trim() || __( 'Untitled chat' );
}

export function NewChatButton( {
	isCreatingSession = false,
	onNewChat,
}: {
	isCreatingSession?: boolean;
	onNewChat: () => void;
} ) {
	useEffect( () => {
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				isCreatingSession ||
				! isKeyboardEvent.primary( event, NEW_CHAT_SHORTCUT_KEY )
			) {
				return;
			}

			event.preventDefault();
			onNewChat();
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ isCreatingSession, onNewChat ] );

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<Button
						type="button"
						className={ styles.newChatButton }
						variant="minimal"
						tone="neutral"
						size="small"
						onClick={ onNewChat }
						disabled={ isCreatingSession }
						aria-busy={ isCreatingSession || undefined }
						aria-keyshortcuts={ ariaKeyShortcut.primary( NEW_CHAT_SHORTCUT_KEY ) }
					/>
				}
			>
				{ isCreatingSession ? __( 'Starting new chat' ) : __( 'New chat' ) }
			</Tooltip.Trigger>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ sprintf(
					// translators: %s: keyboard shortcut for starting a new chat.
					__( 'New chat %s' ),
					displayShortcut.primary( NEW_CHAT_SHORTCUT_KEY )
				) }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}
