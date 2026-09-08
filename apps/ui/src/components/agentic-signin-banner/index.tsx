import { __ } from '@wordpress/i18n';
import { chevronLeft, chevronRight, play } from '@wordpress/icons';
import { Button, Icon, IconButton, VisuallyHidden } from '@wordpress/ui';
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
						<Icon icon={ play } size={ 20 } />
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
		label: __( 'Annotations' ),
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

export function AgenticSigninPrompt() {
	const login = useLogin( { source: 'assistant_tab' } );
	// `leaving` keeps the previous slide mounted while it slides out; `direction`
	// is +1 when the deck moves forward (new slide enters from the right).
	// `run` changes on every move, so re-selecting the slide already showing
	// restarts its clock rather than leaving it wherever it was scrubbed to.
	const [ deck, setDeck ] = useState( {
		index: 0,
		leaving: null as number | null,
		direction: 1,
		run: 0,
	} );
	const [ paused, setPaused ] = useState( false );
	const [ seek, setSeek ] = useState< { to: number; key: number } >();
	const ringRef = useRef< HTMLButtonElement >( null );
	const scrubRef = useRef< HTMLDivElement >( null );
	const slide = slides[ deck.index ];
	const goTo = ( next: number, direction: number ) => {
		setSeek( undefined );
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

	// The ring is painted onto the active dot imperatively, so clear it whenever
	// the deck moves — otherwise the dot we just left keeps a full ring, which
	// shows again the next time that slide comes round.
	useLayoutEffect( () => {
		ringRef.current?.style.setProperty( '--progress', '0' );
		scrubRef.current?.style.setProperty( '--progress', '0' );
	}, [ deck.index, deck.run ] );

	// The active slide's clock drives the ring around its dot and advances the
	// deck when it ends; the ring is painted through a ref (a CSS variable on
	// the dot) so the frame-rate progress never re-renders the prompt.
	const playback = useMemo< Playback >(
		() => ( {
			paused,
			seek,
			// Reduced motion plays no frames, so rest on each slide long enough to
			// read it, then move on — otherwise the deck would never advance.
			reducedMotionHoldMs: REDUCED_MOTION_HOLD_MS,
			onProgress: ( progress ) => {
				ringRef.current?.style.setProperty( '--progress', String( progress ) );
				scrubRef.current?.style.setProperty( '--progress', String( progress ) );
			},
			onEnd: () => {
				setSeek( undefined );
				setDeck( ( current ) => ( {
					index: ( current.index + 1 ) % slides.length,
					leaving: current.index,
					direction: 1,
					run: current.run + 1,
				} ) );
			},
		} ),
		[ paused, seek ]
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
									ref={ i === deck.index ? ringRef : undefined }
									type="button"
									role="tab"
									aria-selected={ i === deck.index }
									aria-label={ item.label }
									className={ clsx( styles.dot, i === deck.index && styles.dotActive ) }
									onClick={ () => goTo( i, i > deck.index ? 1 : -1 ) }
								/>
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
			</div>
		</div>
	);
}
