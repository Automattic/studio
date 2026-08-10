import { __, sprintf } from '@wordpress/i18n';
import { chevronUp, lineSolid, moreVertical } from '@wordpress/icons';
import { Icon, IconButton, Notice } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@/components/menu';
import { useGettingStartedMessage } from '@/data/onboarding/use-getting-started-message';
import styles from './style.module.css';
import type { GettingStartedChecklistView } from '@/data/onboarding/use-getting-started-message';
import type { CSSProperties } from 'react';

// Once every item completes, celebrate briefly and then hide the card for good.
const HIDE_AFTER_COMPLETE_MS = 3500;

const CONFETTI_COLORS = [
	'var(--wpds-color-fg-interactive-brand)',
	'var(--wpds-color-fg-content-success)',
	'var(--wpds-color-fg-content-warning)',
	'var(--wpds-color-fg-content-error)',
];

// Pure per-index jitter (render must stay pure, so no Math.random): a cheap
// sin-hash spreads values in [0, 1) that read as random scatter.
function jitter( index: number, salt: number ): number {
	const value = Math.sin( index * 127.1 + salt * 311.7 ) * 43758.5453;
	return value - Math.floor( value );
}

// A small one-shot burst: rectangles flung radially from the card center,
// spinning and fading. Pure CSS animation; the pieces are generated once.
function ConfettiBurst() {
	const pieces = useMemo(
		() =>
			Array.from( { length: 22 }, ( _, index ) => ( {
				angle: index * ( 360 / 22 ) + ( jitter( index, 1 ) * 24 - 12 ),
				distance: 52 + jitter( index, 2 ) * 48,
				spin: jitter( index, 3 ) * 540 - 270,
				delay: jitter( index, 4 ) * 120,
				color: CONFETTI_COLORS[ index % CONFETTI_COLORS.length ],
				width: 4 + jitter( index, 5 ) * 3,
				height: 6 + jitter( index, 6 ) * 4,
			} ) ),
		[]
	);
	return (
		<div className={ styles.confetti } aria-hidden="true">
			{ pieces.map( ( piece, index ) => (
				<span
					key={ index }
					className={ styles.confettiPiece }
					style={
						{
							'--confetti-angle': `${ piece.angle }deg`,
							'--confetti-distance': `${ piece.distance }px`,
							'--confetti-spin': `${ piece.spin }deg`,
							backgroundColor: piece.color,
							width: `${ piece.width }px`,
							height: `${ piece.height }px`,
							animationDelay: `${ piece.delay }ms`,
						} as CSSProperties
					}
				/>
			) ) }
		</div>
	);
}

function CheckGlyph( { done }: { done: boolean } ) {
	return (
		<span className={ clsx( styles.checkGlyph, done && styles.checkGlyphDone ) } aria-hidden="true">
			{ done ? (
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<circle cx="8" cy="8" r="7" fill="currentColor" />
					{ /* The card is surfaceless, so the checkmark knocks out to the
					     sidebar chrome behind it, not a card surface color. */ }
					<path
						d="M4.5 8.2l2.2 2.2 4.8-4.8"
						stroke="var(--app-chrome-bg, var(--wpds-color-bg-surface-neutral-strong))"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) : (
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					{ /* Dashed ring for not-done: 8 even segments around the
					     r=6.5 circumference (~40.8). */ }
					<circle
						cx="8"
						cy="8"
						r="6.5"
						stroke="currentColor"
						strokeWidth="1"
						strokeDasharray="2.55 2.55"
						strokeLinecap="round"
					/>
				</svg>
			) }
		</span>
	);
}

// Collapsed bar: title, progress count, and a small expand chevron trailing
// the text. The whole bar is one button that restores the full card.
function MinimizedBar( { message }: { message: GettingStartedChecklistView } ) {
	const progress = sprintf(
		/* translators: 1: completed count, 2: total count. */
		__( '%1$d of %2$d' ),
		message.completedCount,
		message.totalCount
	);
	return (
		<Notice.Root
			intent="info"
			icon={ null }
			// Explicit string: Notice defaults spokenMessage to `children` and
			// renders them to a string DURING its own render — which executes
			// child components' hooks inline and corrupts Notice's hook order
			// when children change shape (the confetti toggle crashed it).
			spokenMessage={ message.title }
			className={ clsx( styles.cardPlain, styles.card, styles.cardMinimized ) }
		>
			<button
				type="button"
				className={ clsx( styles.minimizedTrigger, styles.cardTitleInset ) }
				onClick={ message.onToggleMinimized }
			>
				<span className={ styles.minimizedTitle }>{ message.title }</span>
				<span className={ styles.progressCount }>{ progress }</span>
				<span className={ styles.minimizedChevron } aria-hidden="true">
					<Icon icon={ chevronUp } size={ 12 } />
				</span>
			</button>
		</Notice.Root>
	);
}

// The getting-started checklist card. Shares the sidebar-card surface (Notice
// with no status icon). Clicking an incomplete item shows a coachmark rather
// than navigating; items check off from real events.
export function GettingStartedCard( { message }: { message: GettingStartedChecklistView } ) {
	const [ celebrate, setCelebrate ] = useState( false );
	// null until the first render has recorded the mount state: a card that
	// mounts already-complete (reopened later via Help ▸ Getting Started) must
	// neither celebrate nor hide itself.
	const prevCompleteRef = useRef< boolean | null >( null );
	const onDismissRef = useRef( message.onDismiss );
	useEffect( () => {
		onDismissRef.current = message.onDismiss;
	}, [ message.onDismiss ] );
	useEffect( () => {
		if ( prevCompleteRef.current === null || prevCompleteRef.current === message.allComplete ) {
			prevCompleteRef.current = message.allComplete;
			return;
		}
		prevCompleteRef.current = message.allComplete;
		if ( ! message.allComplete ) {
			return;
		}
		// Live completion: burst (unless reduced motion), then hide the card.
		if ( ! window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) {
			setCelebrate( true );
		}
		const timer = setTimeout( () => onDismissRef.current(), HIDE_AFTER_COMPLETE_MS );
		return () => clearTimeout( timer );
	}, [ message.allComplete ] );

	if ( message.minimized ) {
		return <MinimizedBar message={ message } />;
	}

	return (
		<Notice.Root
			intent="info"
			icon={ null }
			// See MinimizedBar: explicit string keeps Notice from render-to-
			// stringing hook-bearing children during render.
			spokenMessage={ message.title }
			className={ clsx( styles.cardPlain, styles.card, styles.confettiHost ) }
		>
			{ celebrate ? <ConfettiBurst /> : null }
			<Notice.Title className={ styles.cardTitleInset }>{ message.title }</Notice.Title>
			<div className={ styles.headerControls }>
				<Menu.Root modal={ false }>
					<Menu.Trigger
						render={
							<IconButton
								size="small"
								variant="minimal"
								tone="neutral"
								icon={ moreVertical }
								label={ __( 'More options' ) }
							/>
						}
					/>
					<Menu.Popup side="bottom" align="end">
						<Menu.Item onClick={ message.onReplayTour }>{ __( 'Replay tour' ) }</Menu.Item>
						<Menu.Item onClick={ message.onDismiss }>{ __( 'Hide' ) }</Menu.Item>
					</Menu.Popup>
				</Menu.Root>
				<IconButton
					size="small"
					variant="minimal"
					tone="neutral"
					icon={ lineSolid }
					label={ __( 'Minimize' ) }
					onClick={ message.onToggleMinimized }
				/>
			</div>
			<div className={ styles.checklist }>
				<ul className={ styles.checklistItems }>
					{ message.items.map( ( item, index ) =>
						item.completed ? (
							<li
								key={ item.id }
								className={ clsx( styles.checklistItem, styles.checklistItemCompleted ) }
								style={ { '--row-index': index } as CSSProperties }
							>
								<CheckGlyph done />
								<span className={ styles.checklistLabel }>{ item.label }</span>
							</li>
						) : (
							<li key={ item.id } style={ { '--row-index': index } as CSSProperties }>
								<button
									type="button"
									className={ styles.checklistItem }
									onClick={ () => message.onActivateItem( item.id ) }
								>
									<CheckGlyph done={ false } />
									<span className={ styles.checklistLabel }>{ item.label }</span>
								</button>
							</li>
						)
					) }
				</ul>
			</div>
		</Notice.Root>
	);
}

// Sidebar mount point: renders the checklist card when the view-model says it
// should show, else nothing. Sits beside AppMessageCards in the sidebar footer.
export function GettingStartedChecklist() {
	const message = useGettingStartedMessage();
	if ( ! message ) {
		return null;
	}
	return <GettingStartedCard message={ message } />;
}
