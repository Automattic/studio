import { __ } from '@wordpress/i18n';
import { thumbsUp, thumbsDown, Icon } from '@wordpress/icons';
import { useAssistant } from '../hooks/use-assistant';
import Button from './button';

interface ChatRatingProps {
	messageApiId: number;
	feedbackReceived: boolean;
	markMessageAsFeedbackReceived: ReturnType<
		typeof useAssistant
	>[ 'markMessageAsFeedbackReceived' ];
	className?: string;
}

export const FeedbackThanks = () => {
	return (
		<div className="text-a8c-gray-70 italic text-xs flex justify-end">
			{ __( 'Thanks for the feedback!' ) }
		</div>
	);
};

export const ChatRating = ( {
	messageApiId,
	markMessageAsFeedbackReceived,
	feedbackReceived,
}: ChatRatingProps ) => {
	const handleRatingClick = async ( feedback: number ) => {
		markMessageAsFeedbackReceived( messageApiId, feedback );
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
						onClick={ () => handleRatingClick( 1 ) }
					>
						<Icon size={ 18 } icon={ thumbsUp } />
						<span className="text-xs">{ __( 'Yes' ) }</span>
					</Button>
					<Button
						variant="icon"
						className="text-a8c-red-50 flex items-center gap-1"
						onClick={ () => handleRatingClick( 0 ) }
					>
						<Icon size={ 18 } icon={ thumbsDown } />
						<span className="text-xs">{ __( 'No' ) }</span>
					</Button>
				</div>
			) }
		</div>
	);
};
