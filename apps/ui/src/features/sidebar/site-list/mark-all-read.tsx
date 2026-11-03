import { __ } from '@wordpress/i18n';
import { errorMessage, toast } from '@/data/app-messages';
import { useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import { ReadStatusIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';
import type { AiSessionSummary } from '@/data/core';

export function MarkAllReadItem( { chats }: { chats: AiSessionSummary[] } ) {
	const { mutateAsync, isPending } = useUpdateSessionMetadata();
	const unread = chats.filter( ( chat ) => chat.unread );
	const markRead = async () => {
		for ( const chat of unread ) {
			try {
				await mutateAsync( { sessionId: chat.id, patch: { unread: false } } );
			} catch ( error ) {
				toast.error( __( 'Couldn’t mark all chats as read' ), {
					description: errorMessage( error ),
				} );
			}
		}
	};
	return (
		<Menu.Item disabled={ ! unread.length || isPending } onClick={ () => void markRead() }>
			<ReadStatusIcon />
			{ __( 'Mark all as read' ) }
		</Menu.Item>
	);
}
