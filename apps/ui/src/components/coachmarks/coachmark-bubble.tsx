import { Popover } from '@base-ui/react/popover';
import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { Button } from '@wordpress/ui';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { CoachmarkPlacement } from '@/data/onboarding/types';
import type { ReactNode } from 'react';

const { ThemeProvider } = unlock( privateApis );

interface CoachmarkBubbleProps {
	anchorElement: HTMLElement;
	title: string;
	description: ReactNode;
	placement: CoachmarkPlacement;
	onDismiss: () => void;
}

// A single arrowed bubble that tracks its anchor. Non-modal, so the app stays
// interactive behind it — the bubble teaches where to click without a scrim.
export function CoachmarkBubble( {
	anchorElement,
	title,
	description,
	placement,
	onDismiss,
}: CoachmarkBubbleProps ) {
	return (
		<Popover.Root
			open
			modal={ false }
			onOpenChange={ ( open ) => {
				// Any close — Esc, the close button, or a press anywhere else —
				// dismisses. A coachmark is ephemeral; clicking on is the goal.
				if ( ! open ) {
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
								<div className={ styles.cardActions }>
									<Button size="small" variant="solid" tone="brand" onClick={ onDismiss }>
										{ __( 'Got it' ) }
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
