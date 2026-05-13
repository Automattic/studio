import { getAiModelLabel } from '@studio/common/ai/models';
import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog, DialogRow } from '@/ui-desks/components';
import styles from './style.module.css';
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
		<Dialog
			ariaLabel={ __( 'Start a new conversation?' ) }
			as="form"
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
			<DialogRow align="center" className={ styles.actions }>
				<Button
					variant="filled"
					label={ __( 'Cancel' ) }
					disabled={ inFlight }
					onClick={ onCancel }
				>
					{ __( 'Cancel' ) }
				</Button>
				<Button
					aria-busy={ inFlight }
					disabled={ inFlight }
					label={ __( 'Start new conversation' ) }
					tone="primary"
					type="submit"
					variant="filled"
				>
					{ inFlight ? __( 'Starting...' ) : __( 'Start new conversation' ) }
				</Button>
			</DialogRow>
		</Dialog>
	);
}
