import { getAiModelLabel } from '@studio/common/ai/models';
import { __, sprintf } from '@wordpress/i18n';
import { ActionButton, PromptDialog, PromptDialogRow } from '@/ui-desks/components';
import styles from './family-switch-confirm-dialog.module.css';
import type { AiModelId } from '@/data/core';

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
	if ( pendingModel === null ) {
		return null;
	}

	const description = sprintf(
		/* translators: 1: current model name, 2: new model name */
		__(
			'Switching from %1$s to %2$s starts a fresh conversation - the two model families do not share memory. Your current chat stays in the sidebar.'
		),
		getAiModelLabel( currentModel ),
		getAiModelLabel( pendingModel )
	);

	return (
		<PromptDialog
			ariaLabel={ __( 'Start a new conversation?' ) }
			className={ styles.dialog }
			gap="compact"
			onClose={ () => {
				if ( ! inFlight ) {
					onCancel();
				}
			} }
			onSubmit={ ( event ) => {
				event.preventDefault();
				if ( ! inFlight ) {
					onConfirm();
				}
			} }
			size="narrow"
		>
			<div className={ styles.header }>
				<h2 className={ styles.title }>{ __( 'Start a new conversation?' ) }</h2>
				<p className={ styles.description }>{ description }</p>
			</div>
			<PromptDialogRow align="center" className={ styles.actions }>
				<ActionButton disabled={ inFlight } onClick={ onCancel }>
					{ __( 'Cancel' ) }
				</ActionButton>
				<ActionButton
					aria-busy={ inFlight }
					className={ styles.primaryAction }
					disabled={ inFlight }
					type="submit"
				>
					{ inFlight ? __( 'Starting...' ) : __( 'Start new conversation' ) }
				</ActionButton>
			</PromptDialogRow>
		</PromptDialog>
	);
}
