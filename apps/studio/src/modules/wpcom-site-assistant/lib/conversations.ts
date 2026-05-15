import { __, sprintf } from '@wordpress/i18n';
import type { WpcomSiteAssistantSessionState } from 'src/modules/wpcom-site-assistant/lib/types';

export const isBlankWpcomSiteAssistantConversation = (
	conversation: WpcomSiteAssistantSessionState
) => conversation.messages.length === 0 && ! conversation.input.trim();

export const getWpcomSiteAssistantConversationUpdatedLabel = (
	conversation: WpcomSiteAssistantSessionState
) =>
	new Intl.DateTimeFormat( undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	} ).format( new Date( conversation.lastUpdated ) );

export const getWpcomSiteAssistantConversationLabel = (
	conversation: WpcomSiteAssistantSessionState
) => {
	const firstUserMessage = conversation.messages.find( ( message ) => message.role === 'user' );
	const fallbackDate = getWpcomSiteAssistantConversationUpdatedLabel( conversation );

	if ( firstUserMessage?.content.trim() ) {
		return firstUserMessage.content.trim().replace( /\s+/g, ' ' ).slice( 0, 64 );
	}

	return sprintf( __( 'Chat from %s' ), fallbackDate );
};

export const getWpcomSiteAssistantConversationMenuLabel = (
	conversation: WpcomSiteAssistantSessionState
) => {
	const label = getWpcomSiteAssistantConversationLabel( conversation );
	const updated = getWpcomSiteAssistantConversationUpdatedLabel( conversation );
	return `${ label } · ${ updated }`;
};

export const shouldShowWpcomSiteAssistantConversationControls = (
	conversations: WpcomSiteAssistantSessionState[],
	selectedConversation?: WpcomSiteAssistantSessionState
) => {
	if ( ! selectedConversation ) {
		return false;
	}

	return ! (
		conversations.length === 1 && isBlankWpcomSiteAssistantConversation( selectedConversation )
	);
};
