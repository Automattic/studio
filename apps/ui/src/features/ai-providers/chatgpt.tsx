import { __ } from '@wordpress/i18n';
import { MessageCircleIcon } from 'lucide-react';
import { Button } from '@/lib/ui';
import type { ProviderConnectionProps } from './types';

function ChatGptConnection( {
	Row,
	connectedBadge,
	connected,
	pending,
	error,
	onConnectionChange,
}: ProviderConnectionProps ) {
	return (
		<Row
			title="ChatGPT"
			badge={ connected ? connectedBadge : null }
			description={ __(
				'Use your ChatGPT plan. Sign in with your OpenAI account; no API key required.'
			) }
			error={ error }
		>
			<Button
				variant="outline"
				disabled={ pending }
				onClick={ () => void onConnectionChange( ! connected ).catch( () => {} ) }
			>
				{ connected ? __( 'Sign out' ) : __( 'Sign in with ChatGPT' ) }
			</Button>
		</Row>
	);
}

export const chatGptUiProvider = { icon: MessageCircleIcon, Connection: ChatGptConnection };
