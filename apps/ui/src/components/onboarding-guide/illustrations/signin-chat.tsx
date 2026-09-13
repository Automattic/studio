import { THINKING_MESSAGES } from '@studio/common/ai/thinking-messages';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import { AnimatedElapsedTime } from '@/ui-classic/components/session-view/thinking-indicator';
import { at, easings, span, useTimeline, type Playback } from './choreography';
import {
	CameraGlyph,
	CheckGlyph,
	FileGlyph,
	PlusGlyph,
	SendGlyph,
	StreamingText,
} from './primitives';
import styles from './style.module.css';
import type { ComponentType } from 'react';

const TYPE_START = 1400;
const TYPE_MS = 42;
const STREAM_MS = 17;
// The real indicator rotates its label every 4s.
const THINKING_LABEL_MS = 4000;
// The elapsed counter runs in time-lapse: a real contact form takes a minute
// or two, and the playback only spends ~13s on it.
const WORKING_TIME_SCALE = 3;

// Signed-out sign-in prompt — a one-shot playback of a Studio Code exchange:
// type a prompt, send it (the composer slides off-stage and the prompt becomes
// a user bubble), watch the agent work through a few tool calls (they stay in
// the transcript, as in the real UI, with the working indicator flowing down
// beneath them), stream the reply, then offer a Replay control. Everything
// derives from the timeline clock `t`.
export function SigninChatIllustration( { playback }: { playback?: Playback } ) {
	const prompt = __( 'Add a contact form to the homepage' );
	const reply = __(
		'Done. I added a contact form below the hero on your homepage, styled it to match your theme, and set it up to email you each new submission. Want me to add a thank-you message after someone submits?'
	);
	const tools: { label: string; Glyph: ComponentType; duration: number }[] = [
		{ label: `${ __( 'Reading' ) } templates/front-page.html`, Glyph: FileGlyph, duration: 2200 },
		{ label: `${ __( 'Creating' ) } patterns/contact-form.php`, Glyph: FileGlyph, duration: 3200 },
		{ label: `${ __( 'Editing' ) } templates/front-page.html`, Glyph: FileGlyph, duration: 2600 },
		{ label: __( 'Taking a screenshot' ), Glyph: CameraGlyph, duration: 2600 },
		{ label: __( 'Validating block markup' ), Glyph: CheckGlyph, duration: 2000 },
	];

	// Cue marks (ms), derived from the copy lengths so translations stay in sync.
	const typeEnd = TYPE_START + prompt.length * TYPE_MS;
	const sentAt = typeEnd + 480;
	const workingAt = sentAt + 600;
	const toolStarts: number[] = [];
	let cursor = workingAt + 1100;
	for ( const tool of tools ) {
		toolStarts.push( cursor );
		cursor += tool.duration;
	}
	const workingEnd = cursor + 400;
	const streamStart = workingEnd + 300;
	const streamEnd = streamStart + reply.length * STREAM_MS;
	const endAt = streamEnd + 1400;

	const { t } = useTimeline( { duration: endAt, loop: false, playback } );

	const promptLen = Math.floor( span( t, TYPE_START, typeEnd, easings.linear ) * prompt.length );
	const replyLen = Math.floor( span( t, streamStart, streamEnd, easings.linear ) * reply.length );
	const sent = at( t, sentAt );
	const typing = ! sent && promptLen > 0;
	const showPlaceholder = sent || promptLen === 0;

	// Composer: vertically centered → slides down on send, fading and blurring
	// away before it reaches the stage edge (the stage has no frame to hide a
	// hard clip behind).
	const sendP = span( t, sentAt, sentAt + 1100, easings.easeInOut );
	const composerY = sendP * 96;
	const composerOp = 1 - span( t, sentAt + 100, sentAt + 900, easings.easeIn );
	const composerBlur = sendP * 3;
	// Bubble: scales/fades up from the composer's spot into place.
	const bubbleP = span( t, sentAt, sentAt + 720, easings.easeOut );
	const working = at( t, workingAt ) && ! at( t, workingEnd + 250 );
	const workingOp =
		span( t, workingAt, workingAt + 250, easings.easeOut ) -
		span( t, workingEnd, workingEnd + 250, easings.easeOut );
	const workingElapsed = Math.max( 0, t - workingAt );
	const thinkingLabel =
		THINKING_MESSAGES[
			Math.floor( workingElapsed / THINKING_LABEL_MS ) % THINKING_MESSAGES.length
		];
	const assistantOp = span( t, streamStart, streamStart + 300, easings.easeOut );

	return (
		<div className={ clsx( styles.chatScene, styles.chatSceneBare ) }>
			<div className={ clsx( styles.chatConversation, styles.chatConversationCompact ) }>
				<div
					className={ styles.userBubble }
					style={ {
						opacity: bubbleP,
						transform: `translateY(${ ( 1 - bubbleP ) * 110 }px) scale(${ 0.9 + 0.1 * bubbleP })`,
					} }
				>
					{ prompt }
				</div>
				{ at( t, toolStarts[ 0 ] ) ? (
					<div className={ styles.toolList }>
						{ tools.map( ( tool, index ) => {
							const toolAt = toolStarts[ index ];
							if ( ! at( t, toolAt ) ) {
								return null;
							}
							const active = ! at( t, toolAt + tool.duration );
							return (
								<span
									key={ tool.label }
									className={ styles.toolChip }
									style={ { opacity: span( t, toolAt, toolAt + 250, easings.easeOut ) } }
								>
									<tool.Glyph />
									<span className={ active ? styles.toolShimmer : undefined }>{ tool.label }</span>
								</span>
							);
						} ) }
					</div>
				) : null }
				{ working ? (
					<div className={ styles.workingRow } style={ { opacity: workingOp } }>
						<AgentWorkingIndicator label={ null } ambient />
						<span>{ thinkingLabel }</span>
						<AnimatedElapsedTime
							elapsedSeconds={ Math.floor( ( workingElapsed * WORKING_TIME_SCALE ) / 1000 ) }
						/>
					</div>
				) : null }
				{ at( t, streamStart ) ? (
					<div className={ styles.assistantText } style={ { opacity: assistantOp } }>
						<StreamingText text={ reply } count={ replyLen } />
					</div>
				) : null }
			</div>
			<div
				className={ clsx( styles.composer, styles.composerCentered ) }
				style={ {
					transform: `translateY(calc(-50% + ${ composerY }px))`,
					opacity: composerOp,
					filter: composerBlur > 0 ? `blur(${ composerBlur }px)` : undefined,
				} }
			>
				<div className={ styles.composerInput }>
					{ showPlaceholder ? (
						<span className={ styles.composerPlaceholder }>
							{ __( 'What can Studio build today?' ) }
						</span>
					) : null }
					{ typing ? (
						<StreamingText
							text={ prompt }
							count={ promptLen }
							className={ styles.composerTyped }
							caretClassName={ styles.composerCaret }
						/>
					) : null }
				</div>
				<div className={ styles.composerBar }>
					<span className={ styles.plusButton }>
						<PlusGlyph />
					</span>
					<div className={ styles.composerButtons }>
						{ sent ? (
							<span className={ styles.stopButton }>
								<span className={ styles.stopGlyph } />
							</span>
						) : null }
						<span
							className={ clsx(
								styles.sendButton,
								( sent || promptLen > 0 ) && styles.sendButtonActive
							) }
						>
							<SendGlyph />
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
