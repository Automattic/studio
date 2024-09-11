import { __ } from '@wordpress/i18n';
import { thumbsUp, thumbsDown, Icon } from '@wordpress/icons';
import { useState } from 'react';
import { CHAT_MESSAGES_STORE_KEY } from '../constants';
import { useAssistant } from '../hooks/use-assistant';
import Button from './button';

interface ChatRatingProps {
	messageId: number;
	instanceId: string;
	className?: string;
}

export const ChatRating = ( { messageId, instanceId }: ChatRatingProps ) => {
	// Pass the instanceId to the useAssistant hook
	const { markMessageAsFeedbackReceived } = useAssistant( instanceId );
	const [ feedbackReceived, setFeedbackReceived ] = useState( () => {
		const storedMessages = localStorage.getItem( CHAT_MESSAGES_STORE_KEY );
		if ( storedMessages ) {
			const messagesDict = JSON.parse( storedMessages );
			const messages = messagesDict[ instanceId ] || [];
			const message = messages.find( ( m ) => m.id === messageId );
			return message ? message.feedbackReceived : false;
		}
		return false;
	} );

	const handleRatingClick = ( feedback: boolean ) => {
		markMessageAsFeedbackReceived( messageId, feedback );
		setFeedbackReceived( true ); // Update state to indicate feedback is received
		localStorage.setItem( `feedback_${ messageId }`, 'true' );
		console.log( feedback );
		console.log( messageId );
	};

	return (
		<div className="flex flex-col mt-4 items-start gap-3">
			{ feedbackReceived ? (
				<div className="text-a8c-gray-70 italic text-xs flex justify-end">
					{ __( 'Thanks for the feedback!' ) }
				</div>
			) : (
				<div className="flex items-center gap-3">
					<span className="text-a8c-gray-70 text-xs">{ __( 'Was this helpful?' ) }</span>
					<Button
						variant="icon"
						className="text-a8c-green-50 flex items-center gap-1"
						onClick={ () => handleRatingClick( true ) }
					>
						<Icon size={ 18 } icon={ thumbsUp } />
						<span className="text-xs">{ __( 'Yes' ) }</span>
					</Button>
					<Button
						variant="icon"
						className="text-a8c-red-50 flex items-center gap-1"
						onClick={ () => handleRatingClick( false ) }
					>
						<Icon size={ 18 } icon={ thumbsDown } />
						<span className="text-xs">{ __( 'No' ) }</span>
					</Button>
				</div>
			) }
		</div>
	);
};
