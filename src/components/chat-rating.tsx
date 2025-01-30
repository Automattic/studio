import { __ } from '@wordpress/i18n';
import { thumbsUp, thumbsDown, Icon } from '@wordpress/icons';
import { useAuth } from 'src/hooks/use-auth';
import { useAppDispatch } from 'src/stores';
import { chatThunks } from 'src/stores/chat-slice';
import Button from './button';

interface ChatRatingProps {
	instanceId: string;
	messageApiId: number;
	feedbackReceived: boolean;
	className?: string;
}

export const FeedbackThanks = () => {
	return (
		<div className="text-a8c-gray-70 italic text-xs flex justify-end mt-4">
			{ __( 'Thanks for the feedback!' ) }
		</div>
	);
};

export const ChatRating = ( { messageApiId, feedbackReceived, instanceId }: ChatRatingProps ) => {
	const { client } = useAuth();
	const dispatch = useAppDispatch();
	const handleRatingClick = async ( feedback: number ) => {
		if ( ! client ) {
			return;
		}

		dispatch(
			chatThunks.sendFeedback( { client, messageApiId, ratingValue: feedback, instanceId } )
		);
	};

	return feedbackReceived ? (
		<FeedbackThanks />
	) : (
		<div className="flex flex-col mt-4 items-start gap-3">
			<div className="flex items-center gap-3">
				<span className="text-a8c-gray-70 text-xs">{ __( 'Was this helpful?' ) }</span>
				<Button
					variant="icon"
					className="text-a8c-green-50 hover:!text-a8c-green-50 flex items-center gap-1"
					onClick={ () => handleRatingClick( 1 ) }
				>
					<Icon size={ 18 } icon={ thumbsUp } />
					<span className="text-xs">{ __( 'Yes' ) }</span>
				</Button>
				<Button
					variant="icon"
					className="text-a8c-red-50 hover:!text-a8c-red-50 flex items-center gap-1"
					onClick={ () => handleRatingClick( 0 ) }
				>
					<Icon size={ 18 } icon={ thumbsDown } />
					<span className="text-xs">{ __( 'No' ) }</span>
				</Button>
			</div>
		</div>
	);
};
