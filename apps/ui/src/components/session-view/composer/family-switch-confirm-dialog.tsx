import { getAiModelLabel } from '@studio/common/ai/models';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { useConfirmOnEnter } from '@/hooks/use-confirm-on-enter';
import styles from './style.module.css';
import type { AiModelId, SelectedModelId } from '@/data/core';

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
	currentModel: SelectedModelId;
	pendingModel: AiModelId | null;
	inFlight: boolean;
	onCancel: () => void;
	onConfirm: () => void;
} ) {
	const confirmLabel = __( 'Yes, new chat' );
	const handleKeyDown = useConfirmOnEnter( confirmLabel );
	const cancelRef = useRef< HTMLButtonElement >( null );

	return (
		<Dialog
			open={ pendingModel !== null }
			onOpenChange={ ( next ) => ! next && ! inFlight && onCancel() }
		>
			<DialogContent
				showCloseButton={ ! inFlight }
				initialFocus={ cancelRef }
				onKeyDown={ handleKeyDown }
			>
				<DialogHeader>
					<DialogTitle>{ __( 'Start a new chat?' ) }</DialogTitle>
					<DialogDescription className={ styles.dialogDescription }>
						{ pendingModel
							? createInterpolateElement(
									sprintf(
										/* translators: 1: current model name, 2: new model name */
										__(
											'Switching from %1$s to %2$s starts a fresh chat because the models don\u2019t share memory. You can find previous chats using <history>Chat history</history> below the chat box.'
										),
										getAiModelLabel( currentModel ),
										getAiModelLabel( pendingModel )
									),
									{ history: <strong /> }
							  )
							: '' }
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose
						ref={ cancelRef }
						disabled={ inFlight }
						render={ <Button variant="outline" /> }
					>
						{ __( 'Cancel' ) }
					</DialogClose>
					<Button
						loading={ inFlight }
						loadingAnnouncement={ __( 'Starting new chat' ) }
						onClick={ onConfirm }
					>
						{ confirmLabel }
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
