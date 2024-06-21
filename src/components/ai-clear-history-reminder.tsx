import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useCallback, useState, useEffect, useRef } from 'react';
import { CLEAR_HISTORY_REMINDER_TIME } from '../constants';
import { Message as MessageType } from '../hooks/use-assistant';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

function AIClearHistoryReminder( {
	lastMessage,
	clearInput,
}: {
	lastMessage?: MessageType;
	clearInput: () => void;
} ) {
	const [ showReminder, setShowReminder ] = useState( false );
	const timeoutId = useRef< NodeJS.Timeout >();
	const currentMessage = useRef< number >();
	const elementRef = useRef< HTMLDivElement >( null );

	useEffect( () => {
		if ( ! lastMessage || lastMessage.role === 'user' ) {
			clearTimeout( timeoutId.current );
			setShowReminder( false );
			return;
		}

		if ( lastMessage.id === currentMessage.current ) {
			return;
		}

		const messageTime = Date.now() - lastMessage?.createdAt;
		const timeToRemind = CLEAR_HISTORY_REMINDER_TIME - messageTime;
		if ( timeToRemind > 0 ) {
			clearTimeout( timeoutId.current );
			setShowReminder( false );
			timeoutId.current = setTimeout( () => {
				setShowReminder( true );
			}, timeToRemind );
		} else {
			setShowReminder( true );
		}

		return () => {
			clearTimeout( timeoutId.current );
		};
	}, [ lastMessage ] );

	useEffect( () => {
		if ( showReminder ) {
			elementRef.current?.scrollIntoView( { behavior: 'smooth' } );
		}
	}, [ showReminder ] );

	const onClearHistory = useCallback( async () => {
		const CLEAR_CONVERSATION_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;

		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Are you sure you want to clear the conversation?' ),
			buttons: [ __( 'OK' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === CLEAR_CONVERSATION_BUTTON_INDEX ) {
			clearInput();
		}
	}, [ clearInput ] );

	if ( ! showReminder ) {
		return null;
	}

	return (
		<div ref={ elementRef } className="mt-8 text-center">
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
