import { __ } from '@wordpress/i18n';
import { Button, Dialog, InputControl } from '@wordpress/ui';
import { useState } from 'react';
import { getSessionTitle } from '@/components/session-view/session-chat-actions';
import { useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import type { AiSessionSummary } from '@/data/core';

// Mounted while renaming; closing unmounts it.
export function RenameChatDialog( {
	session,
	onClose,
}: {
	session: AiSessionSummary;
	onClose: () => void;
} ) {
	const updateSessionMetadata = useUpdateSessionMetadata();
	const [ title, setTitle ] = useState( () => getSessionTitle( session ) );

	return (
		<Dialog.Root open onOpenChange={ ( next ) => ! next && onClose() }>
			<Dialog.Popup size="small">
				<form
					onSubmit={ ( event ) => {
						event.preventDefault();
						// An empty name falls back to the chat's first prompt.
						updateSessionMetadata.mutate( {
							sessionId: session.id,
							patch: { title: title.trim() },
						} );
						onClose();
					} }
				>
					<Dialog.Header>
						<Dialog.Title>{ __( 'Rename chat' ) }</Dialog.Title>
					</Dialog.Header>
					<Dialog.Content>
						<InputControl
							label={ __( 'Name' ) }
							value={ title }
							onChange={ ( event ) => setTitle( event.target.value ) }
							autoFocus
						/>
					</Dialog.Content>
					<Dialog.Footer>
						<Dialog.Action variant="minimal" tone="neutral">
							{ __( 'Cancel' ) }
						</Dialog.Action>
						<Button type="submit" variant="solid" tone="brand">
							{ __( 'Rename' ) }
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
