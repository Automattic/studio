import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useCallback, useState, useEffect, useRef } from 'react';
import { CLEAR_HISTORY_REMINDER_TIME } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';
import { Message as MessageType } from '../stores/chat-slice';
import Button from './button';

function shouldShowReminder( lastMessage?: MessageType ) {
	return (
		lastMessage?.role === 'assistant' &&
		Date.now() - ( lastMessage?.createdAt ?? 0 ) > CLEAR_HISTORY_REMINDER_TIME
	);
}

function AIClearHistoryReminder( {
	lastMessage,
	clearConversation,
}: {
	lastMessage?: MessageType;
	clearConversation: () => void;
} ) {
	const [ showReminder, setShowReminder ] = useState( shouldShowReminder( lastMessage ) );
	const elementRef = useRef< HTMLDivElement >( null );

	useEffect( () => {
		let timeoutId: NodeJS.Timeout;
		const nextValue = shouldShowReminder( lastMessage );
		setShowReminder( nextValue );

		if ( nextValue && lastMessage ) {
			timeoutId = setTimeout( () => {
				setShowReminder( true );
			}, Date.now() - lastMessage.createdAt );
		}

		return () => {
			clearTimeout( timeoutId );
		};
	}, [ lastMessage ] );

	useEffect( () => {
		if ( showReminder ) {
			elementRef.current?.scrollIntoView( { behavior: 'smooth' } );
		}
	}, [ showReminder ] );

	const onClearHistory = useCallback( async () => {
		if ( localStorage.getItem( 'dontShowClearMessagesWarning' ) === 'true' ) {
			clearConversation();
			return;
		}

		const CLEAR_CONVERSATION_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;

		const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
			message: __( 'Are you sure you want to clear the conversation?' ),
			checkboxLabel: __( "Don't show this warning again" ),
			buttons: [ __( 'OK' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === CLEAR_CONVERSATION_BUTTON_INDEX ) {
			if ( checkboxChecked ) {
				localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
			}

			clearConversation();
		}
	}, [ clearConversation ] );

	if ( ! showReminder ) {
		return null;
	}

	return (
		<div ref={ elementRef } className="mt-8 mb-2 text-center">
			{ createInterpolateElement(
				__(
					'This conversation is over two hours old. <button>Clear the history</button> if you have something new to ask.'
				),
				{
					button: <Button variant="link" onClick={ onClearHistory } />,
				}
			) }
		</div>
	);
}

export default AIClearHistoryReminder;
