import { __ } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import { useAddAiCreditsUrl } from '@/hooks/use-add-ai-credits-url';
import styles from './style.module.css';
import type { MouseEvent } from 'react';

export function AiCreditsDetailsDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const connector = useConnector();
	const addAiCreditsUrl = useAddAiCreditsUrl();

	const handleLearnMoreClick = ( event: MouseEvent< HTMLAnchorElement > ) => {
		event.preventDefault();
		void connector.openExternalUrl(
			'https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/'
		);
	};
	const handleBuyCreditsClick = ( event: MouseEvent< HTMLAnchorElement > ) => {
		event.preventDefault();
		void connector.openExternalUrl( addAiCreditsUrl );
	};

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small" initialFocus={ false }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'How AI credits work' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description className={ styles.details }>
						<p className={ styles.introduction }>
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
									className={ styles.buyCreditsLink }
									href={ addAiCreditsUrl }
									onClick={ handleBuyCreditsClick }
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
						className={ styles.learnMoreButton }
						href="https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/"
						onClick={ handleLearnMoreClick }
						target="_blank"
						rel="noreferrer noopener"
					>
						{ __( 'Learn more about AI credits' ) }
					</a>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Close' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
