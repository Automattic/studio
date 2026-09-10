import { __ } from '@wordpress/i18n';
import { chevronLeft, chevronRight } from '@wordpress/icons';
import { Button, Dialog, IconButton, VisuallyHidden } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ComponentType,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	type RefObject,
} from 'react';
import { SigninAnnotateIllustration } from '@/components/onboarding-guide/illustrations/signin-annotate';
import { SigninChatIllustration } from '@/components/onboarding-guide/illustrations/signin-chat';
import { SigninSyncIllustration } from '@/components/onboarding-guide/illustrations/signin-sync';
import { useLogin } from '@/data/queries/use-auth-user';
import { useSaveUserPreferences } from '@/data/queries/use-user-preferences';
import { useConfirmOnEnter } from '@/hooks/use-confirm-on-enter';
import styles from './style.module.css';
import type { Playback } from '@/components/onboarding-guide/illustrations/choreography';
import type { TracksAuthSource } from '@studio/common/lib/record-tracks-event';

export function SigninNotice( { source }: { source: TracksAuthSource } ) {
	const login = useLogin( { source } );

	return (
		<section className={ styles.root } aria-label={ __( 'Sign in to Studio' ) }>
			<div className={ styles.text }>
				<h2 className={ styles.heading }>{ __( 'Sign in to do more with Studio' ) }</h2>
				<ul className={ styles.benefits }>
					<li>
						{ __(
							'Chat with an AI WordPress expert that helps build and edit your site alongside you'
						) }
					</li>
					<li>{ __( 'Share your work instantly with preview links' ) }</li>
					<li>{ __( "Publish to a real WordPress.com site when you're ready" ) }</li>
				</ul>
			</div>
			<div className={ styles.actions }>
				<Button
					type="button"
					variant="solid"
					tone="brand"
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in with WordPress.com' ) }
				</Button>
			</div>
		</section>
	);
}

// The scene is laid out in px for one size and scaled to whatever width the
// stage gets, so nothing clips or reflows as the panel narrows.
const STAGE_WIDTH = 460;
const STAGE_HEIGHT = 345;

const SLIDE_TRANSITION_MS = 360;

// Long enough to read a slide's description when the demos don't play.
const REDUCED_MOTION_HOLD_MS = 9000;

// The prompt remounts whenever the user switches sites; the deck picks up
// where it was (same slide, still paused if it was) instead of starting over.
const carouselMemory = { index: 0, paused: false, progress: 0 };

// Measures its own width and publishes the matching scale, so the slides
// inside can render the scene at its design size and transform to fit.
function Stage( {
	scrubRef,
	paused,
	onSeek,
	onToggle,
	children,
}: {
	scrubRef: RefObject< HTMLDivElement | null >;
	paused: boolean;
	onSeek: ( fraction: number ) => void;
	onToggle: () => void;
	children: ReactNode;
} ) {
	const ref = useRef< HTMLDivElement >( null );
	const [ scale, setScale ] = useState( 1 );

	useLayoutEffect( () => {
		const node = ref.current;
		if ( ! node || typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const update = () => setScale( node.clientWidth / STAGE_WIDTH );
		update();
		const observer = new ResizeObserver( update );
		observer.observe( node );
		return () => observer.disconnect();
	}, [] );

	const seekFromEvent = ( event: ReactPointerEvent< HTMLDivElement > ) => {
		const rect = event.currentTarget.getBoundingClientRect();
		onSeek( ( event.clientX - rect.left ) / rect.width );
	};

	const releasePointer = ( event: ReactPointerEvent< HTMLDivElement > ) => {
		if ( event.currentTarget.hasPointerCapture( event.pointerId ) ) {
			event.currentTarget.releasePointerCapture( event.pointerId );
		}
	};

	return (
		<div
			ref={ ref }
			className={ clsx( styles.stage, paused && styles.stagePaused ) }
			style={ { '--stage-scale': scale } as CSSProperties }
		>
			{ /* The playback is a picture, not a UI: the slides take no pointer events. */ }
			<div className={ styles.scenes } aria-hidden="true">
				{ children }
			</div>
			{ /* A real control, so the animation can be paused by keyboard too.
			     WCAG 2.2.2: the deck auto-advances and loops indefinitely. */ }
			<button
				type="button"
				className={ styles.stageToggle }
				aria-pressed={ paused }
				onClick={ onToggle }
			>
				<VisuallyHidden>
					{ paused ? __( 'Resume the demo' ) : __( 'Pause the demo' ) }
				</VisuallyHidden>
				{ paused ? (
					<span className={ styles.pausedBadge } aria-hidden="true">
						<span className={ styles.pausedGlyph } />
					</span>
				) : null }
			</button>
			{ /* Scrubbable timeline along the bottom edge; shows on hover. */ }
			<div
				className={ styles.scrubber }
				onPointerDown={ ( event ) => {
					event.currentTarget.setPointerCapture( event.pointerId );
					seekFromEvent( event );
				} }
				onPointerMove={ ( event ) => {
					if ( event.buttons & 1 ) {
						seekFromEvent( event );
					}
				} }
				onPointerUp={ releasePointer }
				onPointerCancel={ releasePointer }
			>
				<div className={ styles.scrubberTrack }>
					<div ref={ scrubRef } className={ styles.scrubberFill } />
				</div>
			</div>
		</div>
	);
}

function Slide( { motion, children }: { motion?: string; children: ReactNode } ) {
	return (
		<div className={ clsx( styles.slide, motion ) }>
			<div className={ styles.stageScaler } style={ { width: STAGE_WIDTH, height: STAGE_HEIGHT } }>
				{ children }
			</div>
		</div>
	);
}

// One slide per signed-in benefit: a scripted playback of the feature and a
// line about it. The non-breaking space before each description's last word
// keeps it from wrapping alone.
const slides: {
	id: string;
	label: string;
	description: string;
	Scene: ComponentType< { playback?: Playback } >;
}[] = [
	{
		id: 'chat',
		label: __( 'Studio Code' ),
		description: __(
			'Chat to build themes, write plugins, and make changes to your site. Studio Code reads your files, makes the edits, and checks its work.'
		),
		Scene: SigninChatIllustration,
	},
	{
		id: 'annotate',
		label: __( 'Annotate' ),
		description: __(
			'Point at anything in the site preview and leave a note. Send the notes to chat and watch Studio Code work through them.'
		),
		Scene: SigninAnnotateIllustration,
	},
	{
		id: 'sync',
		label: __( 'Sync' ),
		description: __(
			'Sync content, plugins, themes, and files with WordPress.com or Pressable. Push local changes up, or pull a live site down.'
		),
		Scene: SigninSyncIllustration,
	},
];

// "Switch to Overview" is really "turn Studio Code off": with agentic
// features off, Overview becomes every site's home. Say so, and say how to
// get chat back, before flipping the switch.
function SwitchToOverviewDialog( {
	open,
	onOpenChange,
	onSwitched,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onSwitched: () => void;
} ) {
	const savePreferences = useSaveUserPreferences();
	const confirmLabel = __( 'Turn off and switch' );
	const handleKeyDown = useConfirmOnEnter( confirmLabel );
	const handleConfirm = () =>
		savePreferences.mutate(
			{ agenticFeaturesEnabled: false },
			{
				onSuccess: () => {
					onOpenChange( false );
					onSwitched();
				},
			}
		);

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! savePreferences.isPending ) {
					onOpenChange( next );
				}
			} }
		>
			<Dialog.Popup size="small" onKeyDown={ handleKeyDown }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'Turn off Studio Code?' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description>
						{ __(
							'Switching to Overview turns off Studio Code, so Overview becomes the home for all of your sites. You can turn it back on any time in settings.'
						) }
					</Dialog.Description>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ savePreferences.isPending }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ savePreferences.isPending }
						loadingAnnouncement={ __( 'Turning off Studio Code' ) }
						onClick={ handleConfirm }
					>
						{ confirmLabel }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}

export function AgenticSigninPrompt( {
	onOpenOverview,
}: {
	/** Where "Switch to Overview" goes: the site's overview view. */
	onOpenOverview?: () => void;
} ) {
	const login = useLogin( { source: 'assistant_tab' } );
	// `leaving` keeps the previous slide mounted while it slides out; `direction`
	// is +1 when the deck moves forward (new slide enters from the right).
	// `run` changes on every move, so re-selecting the slide already showing
	// restarts its clock rather than leaving it wherever it was scrubbed to.
	const [ deck, setDeck ] = useState( {
		index: carouselMemory.index,
		leaving: null as number | null,
		direction: 1,
		run: 0,
	} );
	const [ paused, setPaused ] = useState( carouselMemory.paused );
	const [ overviewDialogOpen, setOverviewDialogOpen ] = useState( false );
	useEffect( () => {
		carouselMemory.index = deck.index;
		carouselMemory.paused = paused;
	}, [ deck.index, paused ] );
	// Only the slide restored on mount resumes mid-way; every move after that
	// starts its slide from the top.
	const resumeProgress = deck.run === 0 ? carouselMemory.progress : 0;
	const [ seek, setSeek ] = useState< { to: number; key: number } >();
	const scrubRef = useRef< HTMLDivElement >( null );
	const slide = slides[ deck.index ];
	const goTo = ( next: number, direction: number ) => {
		setSeek( undefined );
		carouselMemory.progress = 0;
		setDeck( ( current ) => ( {
			index: next,
			leaving: next === current.index ? null : current.index,
			direction,
			run: current.run + 1,
		} ) );
	};
	const step = ( delta: number ) =>
		goTo( ( deck.index + delta + slides.length ) % slides.length, delta );

	useEffect( () => {
		if ( deck.leaving === null ) {
			return;
		}
		const id = window.setTimeout(
			() => setDeck( ( current ) => ( { ...current, leaving: null } ) ),
			SLIDE_TRANSITION_MS
		);
		return () => window.clearTimeout( id );
	}, [ deck.index, deck.leaving ] );

	// The scrubber is painted imperatively, so clear it whenever the deck moves.
	useLayoutEffect( () => {
		scrubRef.current?.style.setProperty( '--progress', '0' );
	}, [ deck.index, deck.run ] );

	// The active slide's clock drives the scrubber and advances the deck when
	// it ends; the scrubber is painted through a ref (a CSS variable) so the
	// frame-rate progress never re-renders the prompt.
	const playback = useMemo< Playback >(
		() => ( {
			paused,
			seek,
			// Reduced motion plays no frames, so rest on each slide long enough to
			// read it, then move on — otherwise the deck would never advance.
			reducedMotionHoldMs: REDUCED_MOTION_HOLD_MS,
			initialProgress: resumeProgress,
			onProgress: ( progress ) => {
				carouselMemory.progress = progress;
				scrubRef.current?.style.setProperty( '--progress', String( progress ) );
			},
			onEnd: () => {
				setSeek( undefined );
				carouselMemory.progress = 0;
				setDeck( ( current ) => ( {
					index: ( current.index + 1 ) % slides.length,
					leaving: current.index,
					direction: 1,
					run: current.run + 1,
				} ) );
			},
		} ),
		[ paused, seek, resumeProgress ]
	);
	const seekTo = ( to: number ) =>
		setSeek( ( current ) => ( { to, key: ( current?.key ?? 0 ) + 1 } ) );

	const forward = deck.direction > 0;
	const LeavingScene = deck.leaving === null ? null : slides[ deck.leaving ].Scene;

	return (
		<div className={ styles.promptRoot }>
			<div className={ styles.copy }>
				<h1 className={ styles.promptHeading }>{ __( 'Your personal WordPress expert' ) }</h1>
				<div className={ styles.carousel }>
					<IconButton
						className={ clsx( styles.arrow, styles.arrowPrev ) }
						icon={ chevronLeft }
						label={ __( 'Previous feature' ) }
						size="small"
						variant="minimal"
						tone="neutral"
						onClick={ () => step( -1 ) }
					/>
					<Stage
						scrubRef={ scrubRef }
						paused={ paused }
						onSeek={ seekTo }
						onToggle={ () => setPaused( ( value ) => ! value ) }
					>
						{ LeavingScene && deck.leaving !== null ? (
							<Slide
								key={ `leaving-${ slides[ deck.leaving ].id }` }
								motion={ forward ? styles.slideExitLeft : styles.slideExitRight }
							>
								<LeavingScene playback={ { paused: true } } />
							</Slide>
						) : null }
						{ /* Keyed on the run so each move starts its playback from the top. */ }
						<Slide
							key={ `${ slide.id }-${ deck.run }` }
							motion={
								deck.leaving === null
									? undefined
									: forward
									? styles.slideEnterFromRight
									: styles.slideEnterFromLeft
							}
						>
							<slide.Scene playback={ playback } />
						</Slide>
					</Stage>
					<IconButton
						className={ clsx( styles.arrow, styles.arrowNext ) }
						icon={ chevronRight }
						label={ __( 'Next feature' ) }
						size="small"
						variant="minimal"
						tone="neutral"
						onClick={ () => step( 1 ) }
					/>
					<div className={ styles.transport }>
						<div className={ styles.pager } role="tablist" aria-label={ __( 'Features' ) }>
							{ slides.map( ( item, i ) => (
								<button
									key={ item.id }
									type="button"
									role="tab"
									aria-selected={ i === deck.index }
									className={ clsx(
										styles.pagerLabel,
										i === deck.index && styles.pagerLabelActive
									) }
									onClick={ () => goTo( i, i > deck.index ? 1 : -1 ) }
								>
									{ item.label }
								</button>
							) ) }
						</div>
					</div>
				</div>
				<p className={ styles.description }>{ slide.description }</p>
				<Button
					className={ styles.loginButton }
					type="button"
					variant="solid"
					tone="brand"
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in with WordPress.com' ) }
				</Button>
				{ onOpenOverview ? (
					<Button
						className={ styles.overviewButton }
						type="button"
						variant="minimal"
						tone="neutral"
						size="small"
						onClick={ () => setOverviewDialogOpen( true ) }
					>
						{ __( 'Switch to Overview' ) }
					</Button>
				) : null }
				{ onOpenOverview ? (
					<SwitchToOverviewDialog
						open={ overviewDialogOpen }
						onOpenChange={ setOverviewDialogOpen }
						onSwitched={ onOpenOverview }
					/>
				) : null }
			</div>
		</div>
	);
}
