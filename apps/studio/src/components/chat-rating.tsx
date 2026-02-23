import { __ } from '@wordpress/i18n';
import { thumbsUp, thumbsDown, Icon } from '@wordpress/icons';
import Button from 'src/components/button';
import { useAuth } from 'src/hooks/use-auth';
import { useAppDispatch } from 'src/stores';
import { chatThunks } from 'src/stores/chat-slice';

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

		void dispatch(
			chatThunks.sendFeedback( { client, messageApiId, ratingValue: feedback, instanceId } )
		);
	};

	return feedbackReceived ? (
		<FeedbackThanks />
	) : (
		<div className="flex mt-2">
			<div className="flex items-center gap-1">
				<Button
					variant="icon"
					className="text-a8c-gray-70 hover:!text-a8c-green-50"
					onClick={ () => handleRatingClick( 1 ) }
					tooltipText={ __( 'Helpful' ) }
				>
					<Icon size={ 18 } icon={ thumbsUp } />
				</Button>
				<Button
					variant="icon"
					className="text-a8c-gray-70 hover:!text-a8c-red-50"
					onClick={ () => handleRatingClick( 0 ) }
					tooltipText={ __( 'Unhelpful' ) }
				>
					<Icon size={ 18 } icon={ thumbsDown } />
				</Button>
			</div>
		</div>
	);
};
