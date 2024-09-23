import * as Sentry from '@sentry/electron/renderer';
import { useAuth } from './use-auth';

interface SendFeedbackParams {
	messageId: number;
	chatId: string;
	ratingValue: number;
}

export const useSendFeedback = () => {
	const { client } = useAuth();
	const studioBotId = 'wpcom-studio-chat';

	const sendFeedback = async ( { chatId, messageId, ratingValue }: SendFeedbackParams ) => {
		if ( ! client?.req ) {
			return;
		}

		try {
			await client.req.post( {
				path: `/odie/chat/${ studioBotId }/${ chatId }/${ messageId }/feedback`,
				apiNamespace: 'wpcom/v2',
				body: {
					rating_value: ratingValue,
				},
			} );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		}
	};

	return sendFeedback;
};
