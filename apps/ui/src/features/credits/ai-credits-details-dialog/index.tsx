import { __ } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useAddAiCreditsUrl } from '@/features/credits/use-add-ai-credits-url';
import { useOpenAiCreditsCheckout } from '@/features/credits/use-open-ai-credits-checkout';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Button,
} from '@/lib/ui';
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
	// The href is only for the browser's own affordances (middle click, copy
	// link); the click itself goes through the shared entry point so the trip
	// to checkout is recorded.
	const addAiCreditsUrl = useAddAiCreditsUrl();
	const openCheckout = useOpenAiCreditsCheckout();

	const handleLearnMoreClick = ( event: MouseEvent< HTMLAnchorElement > ) => {
		event.preventDefault();
		void connector.openExternalUrl(
			'https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/'
		);
	};
	const handleBuyCreditsClick = ( event: MouseEvent< HTMLAnchorElement > ) => {
		event.preventDefault();
		openCheckout();
	};

	return (
		<Dialog open={ open } onOpenChange={ onOpenChange }>
			<DialogContent layout="compact" showCloseButton={ false } initialFocus={ false }>
				<DialogHeader>
					<DialogTitle>{ __( 'How AI credits work' ) }</DialogTitle>
				</DialogHeader>
				<DialogDescription tone="default" className={ styles.details } render={ <div /> }>
					<p>
						{ __(
							'AI Credits are how you pay for AI usage in WordPress Studio — things like generating code, building out a site, or running other AI-powered features. They’re not money. You can’t withdraw them, exchange them for cash, or use them outside WordPress Studio.'
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
				</DialogDescription>
				<DialogFooter>
					<a
						className={ styles.learnMoreButton }
						href="https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/"
						onClick={ handleLearnMoreClick }
						target="_blank"
						rel="noreferrer noopener"
					>
						{ __( 'Learn more about AI credits' ) }
					</a>
					<DialogClose render={ <Button variant="outline" /> }>{ __( 'Close' ) }</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
