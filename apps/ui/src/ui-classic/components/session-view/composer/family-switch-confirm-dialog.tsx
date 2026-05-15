import { getAiModelLabel } from '@studio/common/ai/models';
import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import type { AiModelId } from '@/data/core';

/**
 * Confirmation prompt shown when the user picks a model from a different
 * family in the composer dropdown. Cross-family swaps don't share a runtime
 * transcript, so continuing the same JSONL with a different family makes
 * the on-screen history disagree with the agent's actual memory — the only
 * correct action is to start a fresh session.
 *
 * Pure presentation: state and the new-session creation live in the
 * composer (the only caller).
 */
export function FamilySwitchConfirmDialog( {
	currentModel,
	pendingModel,
	inFlight,
	onCancel,
	onConfirm,
}: {
	currentModel: AiModelId;
	pendingModel: AiModelId | null;
	inFlight: boolean;
	onCancel: () => void;
	onConfirm: () => void;
} ) {
	return (
		<Dialog.Root
			open={ pendingModel !== null }
			onOpenChange={ ( next ) => {
				if ( ! next ) {
					onCancel();
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Start a new conversation?' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description>
						{ pendingModel
							? sprintf(
									/* translators: 1: current model name, 2: new model name */
									__(
										'Switching from %1$s to %2$s starts a fresh conversation — the two model families don\u2019t share memory. Your current chat stays in the sidebar.'
									),
									getAiModelLabel( currentModel ),
									getAiModelLabel( pendingModel )
							  )
							: '' }
					</Dialog.Description>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ inFlight }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ inFlight }
						loadingAnnouncement={ __( 'Starting new conversation' ) }
						onClick={ onConfirm }
					>
						{ __( 'Start new conversation' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
