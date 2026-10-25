import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useRef, useState } from 'react';
import { LearnMoreLink } from '@/features/settings';
import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogDismissButton,
	DialogFooter,
	DialogTitle,
	VisuallyHidden,
} from '@/lib/ui';
import { GuideIllustration, isDarkGuideIllustration } from './illustrations';
import styles from './style.module.css';
import type { GuideDefinition } from './guide';

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
	// Reserve the link row for the whole guide, not per page, so paging through a
	// guide where only some pages link out doesn't resize the modal.
	const reservesLearnMore = guide.pages.some( ( { learnMore } ) => learnMore );
	// Without this the dialog focuses the first tabbable child, which on a page
	// that links out is the "Learn more" link — so Enter would open the docs
	// instead of advancing.
	const advanceRef = useRef< HTMLButtonElement >( null );

	const goNext = () => {
		if ( isLast ) {
			onComplete();
		} else {
			setPageIndex( ( index ) => index + 1 );
		}
	};
	const goBack = () => setPageIndex( ( index ) => Math.max( 0, index - 1 ) );

	return (
		<Dialog
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
			<DialogContent
				showCloseButton={ false }
				className={ styles.popup }
				initialFocus={ advanceRef }
				data-orientation-guide
			>
				<GuideIllustration id={ page.illustration } />
				<DialogClose
					className={ clsx(
						styles.close,
						isDarkGuideIllustration( page.illustration ) && styles.closeOnDark
					) }
					render={ <DialogDismissButton label={ __( 'Skip' ) } /> }
				/>
				<div className={ styles.content }>
					{ /* The dialog's accessible name and description follow the active page.
					     The visible copy is rendered separately below so that every page can
					     share one grid cell. */ }
					<DialogTitle render={ <VisuallyHidden /> }>{ page.title() }</DialogTitle>
					<DialogDescription render={ <VisuallyHidden /> }>
						{ page.description() }
					</DialogDescription>
					{ /* All pages occupy the same grid cell, so the box is as tall as the
					     longest one and advancing never resizes the modal. Rendering them
					     identically — rather than measuring the active page — is what keeps
					     the height honest once translations change the copy. */ }
					{ guide.pages.map( ( guidePage, index ) => (
						<div
							key={ index }
							className={ clsx( styles.page, index !== pageIndex && styles.pageHidden ) }
						>
							<div className={ styles.title }>{ guidePage.title() }</div>
							<div className={ styles.description }>{ guidePage.description() }</div>
							{ reservesLearnMore ? (
								<div className={ styles.learnMoreRow }>
									{ guidePage.learnMore ? (
										<LearnMoreLink docsLinksKey={ guidePage.learnMore } />
									) : null }
								</div>
							) : null }
						</div>
					) ) }
				</div>
				<DialogFooter className={ styles.footer }>
					<div className={ styles.footerStart }>
						{ /* Kept mounted on the first page and faded out instead of unmounted,
						     so it eases in alongside the pager rather than appearing from
						     nothing. `visibility` keeps it out of the tab order while hidden. */ }
						<Button
							variant="ghost"
							onClick={ goBack }
							className={ clsx( styles.back, isFirst && styles.backHidden ) }
						>
							{ __( 'Back' ) }
						</Button>
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
						<Button ref={ advanceRef } variant="accent" onClick={ goNext }>
							{ page.action() }
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
