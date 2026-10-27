import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import { useConnector } from '@/data/core';
import { IntroFeatures, IntroHeader } from '@/features/onboarding/intro-content';
import styles from '@/features/onboarding/intro-content/style.module.css';
import { Button, Dialog, DialogClose, DialogContent, DialogDismissButton } from '@/lib/ui';
import type { WhatsNewContent } from './content';

export function WhatsNewDialog( {
	content,
	onClose,
}: {
	content: WhatsNewContent;
	onClose: () => void;
} ) {
	const connector = useConnector();
	const done = useRef< HTMLButtonElement >( null );
	return (
		<Dialog
			open
			onOpenChange={ ( open ) => {
				if ( ! open ) onClose();
			} }
		>
			<DialogContent className={ styles.dialog } showCloseButton={ false } initialFocus={ done }>
				<DialogClose className={ styles.close } render={ <DialogDismissButton /> } />
				<IntroHeader title={ __( 'What’s New in Studio' ) } />
				<IntroFeatures features={ content.features } />
				<div className={ styles.actions }>
					{ content.learnMoreUrl && (
						<Button
							variant="ghost"
							onClick={ () => void connector.openExternalUrl( content.learnMoreUrl! ) }
						>
							{ __( 'Learn more' ) }
						</Button>
					) }
					<Button
						ref={ done }
						variant="accent"
						size="lg"
						className={ styles.primary }
						onClick={ onClose }
					>
						{ __( 'Done' ) }
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
