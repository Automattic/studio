import { getAddAiCreditsUrl } from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import buttonDefense from 'src/components/studio-code-session/wp-ui-button-defense.module.css';
import dialogDefense from 'src/components/studio-code-session/wp-ui-dialog-defense.module.css';
import { getIpcApi } from 'src/lib/get-ipc-api';
import styles from './ai-credits-details-dialog.module.css';
import type { MouseEvent } from 'react';

const AI_CREDITS_GUIDELINES_URL =
	'https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/';

/**
 * Explains what AI credits are and how they're spent. Mirrors the agentic
 * UI's dialog so the answer reads the same wherever the user asks it.
 */
export function AiCreditsDetailsDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const addAiCreditsUrl = getAddAiCreditsUrl( { returnsToDesktop: true } );

	const openExternal = ( url: string ) => ( event: MouseEvent< HTMLAnchorElement > ) => {
		event.preventDefault();
		void getIpcApi().openURL( url );
	};

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small" initialFocus={ false } className={ dialogDefense.popup }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'How AI credits work' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description className={ styles.details }>
						<p>
							{ __(
								'AI Credits are how you pay for AI usage in Studio — things like generating code, building out a site, or running other AI-powered features. They’re not money. You can’t withdraw them, exchange them for cash, or use them outside Studio.'
							) }
						</p>
						<section className={ styles.section }>
							<h3>{ __( 'How usage is calculated' ) }</h3>
							<ul>
								<li>{ __( 'AI credits are different from tokens.' ) }</li>
								<li>{ __( 'Different AI models use credits at different rates.' ) }</li>
								<li>{ __( 'Longer or more complex tasks can use more credits.' ) }</li>
							</ul>
						</section>
						<section className={ styles.section }>
							<h3>{ __( 'Buying more credits' ) }</h3>
							<p>
								{ __(
									'Your account includes a one-time free allowance to try Studio Code. When it is used, you can '
								) }
								<a
									className={ styles.link }
									href={ addAiCreditsUrl }
									onClick={ openExternal( addAiCreditsUrl ) }
									target="_blank"
									rel="noreferrer noopener"
								>
									{ __( 'buy more credits' ) }
								</a>
								{ __( '. Purchased credits do not expire.' ) }
							</p>
						</section>
					</Dialog.Description>
				</Dialog.Content>
				<Dialog.Footer>
					<a
						className={ styles.link }
						href={ AI_CREDITS_GUIDELINES_URL }
						onClick={ openExternal( AI_CREDITS_GUIDELINES_URL ) }
						target="_blank"
						rel="noreferrer noopener"
					>
						{ __( 'Learn more about AI credits' ) }
					</a>
					<Dialog.Action variant="minimal" tone="neutral" className={ buttonDefense.button }>
						{ __( 'Close' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
