import { Popover } from '@base-ui/react/popover';
import { __, sprintf } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { Button } from '@wordpress/ui';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { CoachmarkPlacement } from '@/data/onboarding/types';
import type { KeyboardEvent, ReactNode } from 'react';

const { ThemeProvider } = unlock( privateApis );

interface StepCardProps {
	anchorElement: HTMLElement;
	title: string;
	description: ReactNode;
	placement: CoachmarkPlacement;
	// 0-based; omitted for single (non-tour) coachmarks.
	stepIndex?: number;
	stepCount?: number;
	isLast: boolean;
	onNext: () => void;
	onBack?: () => void;
	onDismiss: () => void;
}

export function StepCard( {
	anchorElement,
	title,
	description,
	placement,
	stepIndex,
	stepCount,
	isLast,
	onNext,
	onBack,
	onDismiss,
}: StepCardProps ) {
	const isTour = typeof stepIndex === 'number' && typeof stepCount === 'number';
	const nextLabel = isTour ? ( isLast ? __( 'Done' ) : __( 'Next' ) ) : __( 'Got it' );

	const onKeyDown = ( event: KeyboardEvent< HTMLDivElement > ) => {
		if ( event.key === 'ArrowRight' ) {
			event.preventDefault();
			onNext();
		} else if ( event.key === 'ArrowLeft' && onBack ) {
			event.preventDefault();
			onBack();
		}
	};

	return (
		<Popover.Root
			open
			// Non-modal: the cutout keeps the app interactive behind the card.
			modal={ false }
			onOpenChange={ ( open, details ) => {
				if ( open ) {
					return;
				}
				// Esc and the close button dismiss. Outside-press must NOT —
				// clicking the spotlit target (in the cutout) is "outside" the
				// card, and dimmed-area clicks are handled by the spotlight.
				if ( details.reason === 'escape-key' || details.reason === 'close-press' ) {
					onDismiss();
				}
			} }
		>
			<Popover.Portal>
				<Popover.Positioner
					anchor={ anchorElement }
					side={ placement.side }
					align={ placement.align }
					sideOffset={ 12 }
					className={ styles.positioner }
				>
					{ /* Re-establish the density context lost when portaling to
					     document.body, same as components/menu. */ }
					<ThemeProvider density="compact">
						<Popover.Popup
							className={ `${ styles.card } ${ motionStyles.motion }` }
							onKeyDown={ onKeyDown }
							aria-label={ title }
						>
							{ /* Pointer toward the anchor. The positioner tracks its
							     inline position; per-side offset/rotation is CSS. */ }
							<Popover.Arrow className={ styles.arrow }>
								<svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true">
									<path className={ styles.arrowShape } d="M0 8 L8 1 L16 8" />
								</svg>
							</Popover.Arrow>
							<div className={ styles.cardBody }>
								<h2 className={ styles.cardTitle }>{ title }</h2>
								<div className={ styles.cardDescription }>{ description }</div>
							</div>
							<div className={ styles.cardFooter }>
								{ isTour ? (
									<span className={ styles.stepCounter }>
										{ sprintf(
											/* translators: 1: current step number, 2: total steps. */
											__( '%1$d of %2$d' ),
											( stepIndex as number ) + 1,
											stepCount as number
										) }
									</span>
								) : (
									<span />
								) }
								<div className={ styles.cardActions }>
									{ onBack ? (
										<Button size="small" variant="minimal" tone="neutral" onClick={ onBack }>
											{ __( 'Back' ) }
										</Button>
									) : null }
									<Button size="small" variant="solid" tone="brand" onClick={ onNext }>
										{ nextLabel }
									</Button>
								</div>
							</div>
							<Popover.Close className={ styles.cardClose } aria-label={ __( 'Dismiss' ) }>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<path
										d="M6 6l12 12M18 6L6 18"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
									/>
								</svg>
							</Popover.Close>
						</Popover.Popup>
					</ThemeProvider>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
