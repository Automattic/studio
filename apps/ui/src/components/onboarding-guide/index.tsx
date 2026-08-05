import { __ } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { OrientationIllustration } from './illustrations';
import styles from './style.module.css';
import type { GuideDefinition } from '@/data/onboarding/orientation-guide';

interface OnboardingGuideProps {
	guide: GuideDefinition;
	onComplete: () => void;
	onDismiss: () => void;
}

// A focused, paged orientation modal in the spirit of Gutenberg's Guide:
// full-bleed illustration on top, copy in the middle, a dot pager and
// Back/Next at the bottom. It demands attention — a backdrop, no click-outside
// dismissal — so the welcome isn't lost with a stray click.
export function OnboardingGuide( { guide, onComplete, onDismiss }: OnboardingGuideProps ) {
	const [ pageIndex, setPageIndex ] = useState( 0 );
	const page = guide.pages[ pageIndex ];
	const isFirst = pageIndex === 0;
	const isLast = pageIndex === guide.pages.length - 1;

	const goNext = () => {
		if ( isLast ) {
			onComplete();
		} else {
			setPageIndex( ( index ) => index + 1 );
		}
	};
	const goBack = () => setPageIndex( ( index ) => Math.max( 0, index - 1 ) );

	return (
		<Dialog.Root
			open
			modal
			// No dismissal by clicking the backdrop — only the close button, Esc,
			// or finishing the guide.
			disablePointerDismissal
			onOpenChange={ ( open, details ) => {
				if ( open ) {
					return;
				}
				if ( details.reason === 'escape-key' || details.reason === 'close-press' ) {
					onDismiss();
				}
			} }
		>
			<Dialog.Popup size="small" className={ styles.popup } data-orientation-guide>
				<OrientationIllustration id={ page.illustration } />
				<Dialog.CloseIcon label={ __( 'Skip' ) } className={ styles.close } />
				<Dialog.Content className={ styles.content }>
					<Dialog.Title className={ styles.title }>{ page.title() }</Dialog.Title>
					<Dialog.Description className={ styles.description }>
						{ page.description() }
					</Dialog.Description>
				</Dialog.Content>
				<Dialog.Footer className={ styles.footer }>
					<div className={ styles.footerStart }>
						{ ! isFirst ? (
							<Button variant="minimal" tone="neutral" onClick={ goBack }>
								{ __( 'Back' ) }
							</Button>
						) : null }
					</div>
					<div className={ styles.pager } aria-hidden="true">
						{ guide.pages.map( ( _, index ) => (
							<span
								key={ index }
								className={ clsx( styles.dot, index === pageIndex && styles.dotActive ) }
							/>
						) ) }
					</div>
					<div className={ styles.footerEnd }>
						<Button variant="solid" tone="brand" onClick={ goNext }>
							{ page.action() }
						</Button>
					</div>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
