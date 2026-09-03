import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import { privateApis } from '@wordpress/theme';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { unlock } from '@/lock-unlock';
import {
	BLOG_CTA,
	BLOG_HEADING,
	BLOG_PAGE_BG_ON_DARK,
	BLOG_PAGE_BG_ON_LIGHT,
	BLOG_POSTS,
	BlogPage,
} from './blog-page';
import {
	at,
	easings,
	sample,
	span,
	useTimeline,
	type Keyframe,
	type Playback,
} from './choreography';
import { CameraGlyph, Cursor, FileGlyph, PlusGlyph, SendGlyph, StreamingText } from './primitives';
import styles from './style.module.css';
import type { ComponentType, CSSProperties } from 'react';

const { ThemeProvider } = unlock( privateApis );

const TYPE_MS = 40;
const STREAM_MS = 17;
const CLICK = { down: 90, up: 160 };
// The scene is a 460×345 camera over a wider "world": the Studio window with
// the chat pane on the left and the preview pane on the right.
const VIEW = { w: 460, h: 345 };
const CHAT_WIDTH = 230;
const WORLD = { w: 690, h: 345 };
const PAGE_ORIGIN = { x: CHAT_WIDTH, y: 0 };
// The Annotate button and popup actions are sized explicitly in CSS so the
// cursor can aim at them (world px / popup-relative px).
const ANNOTATE_BUTTON = { x: CHAT_WIDTH + 407, y: 22 };
const NOTE_ZOOM = 1.45;
const SAVE_OFFSET = { x: 122, y: 99 };
const SUBMIT_OFFSET = { x: 189, y: 99 };

type Box = { x: number; y: number; w: number; h: number };
type Target = {
	tag: string;
	text: string;
	comment: string;
	box: Box;
	popup: { x: number; y: number };
};

const POPUP = { w: 240, h: 118 };

// Frames the element and its popup together, kept inside the world.
function frameNote( target: Target, zoom: number ): { x: number; y: number } {
	const left = Math.min( target.box.x, target.popup.x );
	const right = Math.max( target.box.x + target.box.w, target.popup.x + POPUP.w );
	const top = Math.min( target.box.y, target.popup.y );
	const bottom = Math.max( target.box.y + target.box.h, target.popup.y + POPUP.h );
	const halfW = VIEW.w / 2 / zoom;
	const halfH = VIEW.h / 2 / zoom;
	return {
		x: Math.min( WORLD.w - halfW, Math.max( halfW, PAGE_ORIGIN.x + ( left + right ) / 2 ) ),
		y: Math.min( WORLD.h - halfH, Math.max( halfH, PAGE_ORIGIN.y + ( top + bottom ) / 2 ) ),
	};
}

// Signed-out sign-in prompt — annotations in the Studio window. Open tight on
// the preview's Annotate button, follow the cursor down to three elements
// (highlight → marker → the inspector's note popup), send the last one to
// chat, then pull back to the chat pane while the agent works through the
// notes and the preview updates beside it. One-shot with Replay.
export function SigninAnnotateIllustration( { playback }: { playback?: Playback } ) {
	const pageBg = useColorScheme() === 'dark' ? BLOG_PAGE_BG_ON_DARK : BLOG_PAGE_BG_ON_LIGHT;
	const targets: Target[] = [
		{
			tag: 'h1',
			text: BLOG_HEADING,
			comment: __( 'Make this bigger and bolder' ),
			box: { x: 24, y: 56, w: 300, h: 30 },
			popup: { x: 24, y: 96 },
		},
		{
			tag: 'a',
			text: BLOG_CTA,
			comment: __( 'Make this button green' ),
			box: { x: 24, y: 142, w: 92, h: 28 },
			popup: { x: 24, y: 180 },
		},
		{
			tag: 'h2',
			text: BLOG_POSTS[ 0 ].title,
			comment: __( 'Add a short excerpt under each post' ),
			box: { x: 76, y: 206, w: 190, h: 20 },
			popup: { x: 24, y: 80 },
		},
	];
	const reply = __( 'Done. All three notes are in — take a look at the preview.' );
	const tools: { label: string; Glyph: ComponentType; duration: number }[] = [
		{ label: `${ __( 'Reading' ) } templates/front-page.html`, Glyph: FileGlyph, duration: 1500 },
		{ label: `${ __( 'Editing' ) } templates/front-page.html`, Glyph: FileGlyph, duration: 2600 },
		{ label: __( 'Taking a screenshot' ), Glyph: CameraGlyph, duration: 1400 },
	];

	// ---- Cue marks ----
	const annotateAt = 1400;
	const path: Keyframe[] = [
		{ at: 0, x: 600, y: 120, scale: 1, opacity: 0, ease: easings.easeOut },
		{ at: 400, x: 600, y: 120, scale: 1, opacity: 1, ease: easings.easeInOut },
		{ at: annotateAt - 100, ...ANNOTATE_BUTTON, scale: 1, opacity: 1, ease: easings.easeOut },
		{ at: annotateAt, ...ANNOTATE_BUTTON, scale: 0.86, opacity: 1, ease: easings.easeOut },
		{
			at: annotateAt + CLICK.up,
			...ANNOTATE_BUTTON,
			scale: 1,
			opacity: 1,
			ease: easings.easeInOut,
		},
	];
	// Opens tight on the preview's top-right corner, then rides along with
	// each note before pulling back to the chat pane.
	const cameraPath: Keyframe[] = [
		{ at: 0, x: 585, y: 78, zoom: 2.2, ease: easings.easeInOut },
		{ at: annotateAt + 200, x: 585, y: 78, zoom: 2.2, ease: easings.easeInOut },
	];
	const notes: { clickAt: number; typeStart: number; typeEnd: number; closeAt: number }[] = [];
	let cursor = annotateAt + 300;
	targets.forEach( ( target, index ) => {
		const last = index === targets.length - 1;
		const center = {
			x: PAGE_ORIGIN.x + target.box.x + target.box.w * 0.55,
			y: PAGE_ORIGIN.y + target.box.y + target.box.h / 2,
		};
		const clickAt = cursor + 900;
		const typeStart = clickAt + 500;
		const typeEnd = typeStart + target.comment.length * TYPE_MS;
		const action = last ? SUBMIT_OFFSET : SAVE_OFFSET;
		const button = {
			x: PAGE_ORIGIN.x + target.popup.x + action.x,
			y: PAGE_ORIGIN.y + target.popup.y + action.y,
		};
		const closeAt = typeEnd + 700;
		path.push(
			{ at: clickAt - 100, ...center, scale: 1, opacity: 1, ease: easings.easeOut },
			{ at: clickAt, ...center, scale: 0.86, opacity: 1, ease: easings.easeOut },
			{ at: clickAt + CLICK.up, ...center, scale: 1, opacity: 1, ease: easings.easeInOut },
			{ at: closeAt - 100, ...button, scale: 1, opacity: 1, ease: easings.easeOut },
			{ at: closeAt, ...button, scale: 0.86, opacity: 1, ease: easings.easeOut },
			{ at: closeAt + CLICK.up, ...button, scale: 1, opacity: 1, ease: easings.easeInOut }
		);
		// Arrive just before the click, then hold until the popup closes so the
		// camera doesn't drift while the note is being written.
		const frame = frameNote( target, NOTE_ZOOM );
		cameraPath.push(
			{ at: clickAt - 150, ...frame, zoom: NOTE_ZOOM, ease: easings.easeInOut },
			{ at: closeAt + CLICK.up, ...frame, zoom: NOTE_ZOOM, ease: easings.easeInOut }
		);
		notes.push( { clickAt, typeStart, typeEnd, closeAt } );
		cursor = closeAt + 300;
	} );
	const sendAt = notes[ notes.length - 1 ].closeAt;
	path.push( { at: sendAt + 900, x: 720, y: 380, scale: 1, opacity: 0 } );
	cameraPath.push(
		{
			at: sendAt + 300,
			...frameNote( targets[ 2 ], NOTE_ZOOM ),
			zoom: NOTE_ZOOM,
			ease: easings.easeInOut,
		},
		{ at: sendAt + 1400, x: 235, y: 172, zoom: 1 }
	);
	const chatAt = sendAt + 600;
	const workingAt = chatAt + 800;
	const toolStarts: number[] = [];
	let toolCursor = workingAt + 900;
	for ( const tool of tools ) {
		toolStarts.push( toolCursor );
		toolCursor += tool.duration;
	}
	// The edits land in the preview while the agent is editing the template.
	const editAt = toolStarts[ 1 ];
	const changeAt = [ editAt + 500, editAt + 1300, editAt + 2000 ];
	const workingEnd = toolCursor + 200;
	const streamStart = workingEnd + 300;
	const streamEnd = streamStart + reply.length * STREAM_MS;
	const endAt = streamEnd + 1400;

	const { t } = useTimeline( { duration: endAt, loop: false, playback } );

	// ---- Derived state ----
	const pointer = sample( t, path );
	const camera = sample( t, cameraPath );
	const picking = at( t, annotateAt ) && ! at( t, sendAt );
	const openIndex = notes.findIndex(
		( note ) => at( t, note.clickAt ) && ! at( t, note.closeAt + CLICK.down )
	);
	// The hover highlight leads the click: it lands on the next element while
	// the cursor is still on its way there.
	const hoverIndex = picking
		? notes.findIndex( ( note ) => at( t, note.clickAt - 450 ) && ! at( t, note.clickAt ) )
		: -1;
	const sent = at( t, sendAt );
	// Sending clears the markers from the page.
	const markersOp = 1 - span( t, sendAt + 200, sendAt + 600, easings.easeIn );
	const bubbleP = span( t, chatAt, chatAt + 400, easings.easeOut );
	// The composer sits in its busy state (stop button, queue hint) until the
	// reply has finished streaming.
	const busy = sent && ! at( t, streamEnd );
	const working = at( t, workingAt ) && ! at( t, workingEnd + 250 );
	const workingOp =
		span( t, workingAt, workingAt + 250, easings.easeOut ) -
		span( t, workingEnd, workingEnd + 250, easings.easeOut );
	const headingP = span( t, changeAt[ 0 ], changeAt[ 0 ] + 500, easings.easeInOut );
	const ctaP = span( t, changeAt[ 1 ], changeAt[ 1 ] + 400, easings.easeInOut );
	// One excerpt per post, landing in quick succession.
	const excerptP = [ 0, 220, 440 ].map( ( delay ) =>
		span( t, changeAt[ 2 ] + delay, changeAt[ 2 ] + delay + 450, easings.easeOut )
	);
	const replyLen = Math.floor( span( t, streamStart, streamEnd, easings.linear ) * reply.length );
	const assistantOp = span( t, streamStart, streamStart + 300, easings.easeOut );

	return (
		<div className={ clsx( styles.chatScene, styles.chatSceneBare ) }>
			<div
				className={ styles.annoWorld }
				style={ {
					transform: `translate(${ VIEW.w / 2 }px, ${ VIEW.h / 2 }px) scale(${
						camera.zoom
					}) translate(${ -camera.x }px, ${ -camera.y }px)`,
				} }
			>
				<div className={ styles.annoChat }>
					<div className={ styles.annoChatBody }>
						{ sent ? (
							<span
								className={ styles.annoChatBubble }
								style={ {
									opacity: bubbleP,
									transform: `translateY(${ ( 1 - bubbleP ) * 12 }px)`,
								} }
							>
								{ __( '3 annotations submitted' ) }
							</span>
						) : null }
						{ at( t, toolStarts[ 0 ] ) ? (
							<span className={ styles.annoChatTools }>
								{ tools.map( ( tool, index ) => {
									const toolAt = toolStarts[ index ];
									if ( ! at( t, toolAt ) ) {
										return null;
									}
									const active = ! at( t, toolAt + tool.duration );
									return (
										<span
											key={ tool.label }
											className={ styles.annoChatTool }
											style={ { opacity: span( t, toolAt, toolAt + 250, easings.easeOut ) } }
										>
											<tool.Glyph />
											<span className={ active ? styles.toolShimmer : undefined }>
												{ tool.label }
											</span>
										</span>
									);
								} ) }
							</span>
						) : null }
						{ working ? (
							<span className={ styles.annoChatWorking } style={ { opacity: workingOp } }>
								<AgentWorkingIndicator className={ styles.annoChatIndicator } label={ null } />
								{ __( 'Working…' ) }
							</span>
						) : null }
						{ at( t, streamStart ) ? (
							<span className={ styles.annoChatReply } style={ { opacity: assistantOp } }>
								<StreamingText text={ reply } count={ replyLen } />
							</span>
						) : null }
					</div>
					<div className={ styles.annoChatComposer }>
						<span className={ styles.annoChatPlaceholder }>
							{ busy
								? __( 'Queue the next message while I work…' )
								: __( 'What can Studio build today?' ) }
						</span>
						<span className={ styles.annoChatComposerBar }>
							<span className={ styles.annoChatPlus }>
								<PlusGlyph />
							</span>
							<span className={ styles.annoChatComposerButtons }>
								{ busy ? (
									<span className={ styles.annoChatStop }>
										<span className={ styles.annoChatStopGlyph } />
									</span>
								) : null }
								<span className={ styles.annoChatSend }>
									<SendGlyph />
								</span>
							</span>
						</span>
					</div>
				</div>

				<ThemeProvider color={ { background: pageBg } }>
					<div
						className={ styles.annoPreview }
						style={ { '--anno-page-bg': pageBg } as CSSProperties }
					>
						<span className={ clsx( styles.annoPencil, picking && styles.annoPencilActive ) }>
							<Icon icon={ pencil } size={ 16 } />
							{ __( 'Annotate' ) }
						</span>

						<BlogPage
							headingProgress={ headingP }
							ctaAccent={ ctaP > 0.5 }
							excerptProgress={ excerptP }
						>
							{ hoverIndex >= 0 ? (
								<span
									className={ styles.annoHighlight }
									style={ {
										left: targets[ hoverIndex ].box.x - 2,
										top: targets[ hoverIndex ].box.y - 2,
										width: targets[ hoverIndex ].box.w + 4,
										height: targets[ hoverIndex ].box.h + 4,
									} }
								/>
							) : null }
							{ notes.map( ( note, index ) => {
								if ( ! at( t, note.clickAt ) ) {
									return null;
								}
								const p = span( t, note.clickAt, note.clickAt + 220, easings.easeOut );
								const box = targets[ index ].box;
								return (
									<span
										key={ targets[ index ].tag }
										className={ styles.annoMarker }
										style={ {
											left: box.x + box.w * 0.55,
											top: box.y + box.h / 2,
											opacity: p * markersOp,
											transform: `translate(-50%, -50%) scale(${ 0.6 + 0.4 * p })`,
										} }
									>
										{ index + 1 }
									</span>
								);
							} ) }

							{ openIndex >= 0 ? (
								<div
									className={ styles.annoPopup }
									style={ {
										left: targets[ openIndex ].popup.x,
										top: targets[ openIndex ].popup.y,
										opacity: span(
											t,
											notes[ openIndex ].clickAt,
											notes[ openIndex ].clickAt + 200
										),
									} }
								>
									<span className={ styles.annoPopupTarget }>
										{ targets[ openIndex ].tag } — { targets[ openIndex ].text }
									</span>
									<span className={ styles.annoPopupTextarea }>
										{ at( t, notes[ openIndex ].typeStart ) ? (
											<StreamingText
												text={ targets[ openIndex ].comment }
												count={ Math.floor(
													span(
														t,
														notes[ openIndex ].typeStart,
														notes[ openIndex ].typeEnd,
														easings.linear
													) * targets[ openIndex ].comment.length
												) }
												caretClassName={ styles.annoPopupCaret }
											/>
										) : (
											<span className={ styles.annoPopupPlaceholder }>
												{ __( 'What should change about this element?' ) }
											</span>
										) }
									</span>
									<span className={ styles.annoPopupActions }>
										<span className={ styles.annoPopupCancel }>{ __( 'Cancel' ) }</span>
										<span
											className={ clsx(
												styles.annoPopupSave,
												! at( t, notes[ openIndex ].typeStart + 200 ) &&
													styles.annoPopupSaveDisabled,
												openIndex < notes.length - 1 &&
													at( t, notes[ openIndex ].closeAt ) &&
													styles.annoPopupPressed
											) }
										>
											{ __( 'Save' ) }
										</span>
										<span
											className={ clsx(
												styles.annoPopupSubmit,
												openIndex === notes.length - 1 &&
													at( t, notes[ openIndex ].closeAt ) &&
													styles.annoPopupPressed
											) }
										>
											{ __( 'Send to chat' ) }
										</span>
									</span>
								</div>
							) : null }
						</BlogPage>
					</div>
				</ThemeProvider>

				<Cursor
					className={ styles.sceneCursor }
					style={ {
						opacity: pointer.opacity,
						transform: `translate(${ pointer.x }px, ${ pointer.y }px) scale(${
							pointer.scale / camera.zoom
						})`,
					} }
				/>
			</div>
		</div>
	);
}
