import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { at, easings, envelope, span, useTimeline } from './choreography';
import { StreamingText } from './primitives';
import styles from './style.module.css';

function PlusGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M8 3.5 V12.5 M3.5 8 H12.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function SendGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M8 12.5 V4 M4.5 7.5 L8 4 L11.5 7.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function FileGlyph() {
	return (
		<svg className={ styles.toolIcon } viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M4 2 H9 L12.5 5.5 V14 H4 Z M9 2 V5.5 H12.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.1"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

const TYPE_MS = 42;
const STREAM_MS = 17;

// Page 2 (signed in) — Studio Code. A one-time playback: type a prompt, send it
// (the composer slides off-stage and the prompt becomes a user bubble), stream
// the reply, then show a tool call that keeps "reading" and a Replay control.
// Everything derives from the timeline clock `t`; theme-adaptive.
export function ChatIllustration() {
	const prompt = __( 'Add a contact form to the homepage' );
	const reply = __(
		'Good idea! I’ll open the homepage and check to see where the best place would be for a contact form.'
	);

	// Cue marks (ms), derived from the copy lengths so translations stay in sync.
	const typeEnd = 550 + prompt.length * TYPE_MS;
	const sentAt = typeEnd + 480;
	const streamStart = sentAt + 680;
	const streamEnd = streamStart + reply.length * STREAM_MS;
	const toolAt = streamEnd + 300;
	const replayAt = streamEnd + 800;

	const { t, restart } = useTimeline( { duration: replayAt + 900, loop: false } );

	const promptLen = Math.floor( span( t, 550, typeEnd, easings.linear ) * prompt.length );
	const replyLen = Math.floor( span( t, streamStart, streamEnd, easings.linear ) * reply.length );
	const sent = at( t, sentAt );
	const typing = ! sent && promptLen > 0;
	const showPlaceholder = sent || promptLen === 0;
	const placeholder = sent
		? __( 'Queue the next message while I work…' )
		: __( 'What can Studio build today?' );

	// Composer: centered → slides down and off-stage on send.
	const composerY = -54 + span( t, sentAt, sentAt + 800, easings.easeInOut ) * 186;
	// Bubble: scales/fades up from the composer into place.
	const bubbleP = span( t, sentAt, sentAt + 520, easings.easeOut );
	const assistantOp = span( t, sentAt, sentAt + 300, easings.easeOut );
	const toolOp = envelope( t, toolAt, 300 );
	const replayOp = span( t, replayAt, replayAt + 300, easings.easeOut );

	return (
		<div className={ styles.chatScene }>
			<button
				type="button"
				className={ styles.replayButton }
				style={ { opacity: replayOp, pointerEvents: replayOp > 0.5 ? 'auto' : 'none' } }
				onClick={ restart }
			>
				{ __( 'Replay' ) }
			</button>
			<div className={ styles.chatConversation }>
				<div
					className={ styles.userBubble }
					style={ {
						opacity: bubbleP,
						transform: `translateY(${ ( 1 - bubbleP ) * 46 }px) scale(${ 0.9 + 0.1 * bubbleP })`,
					} }
				>
					{ prompt }
				</div>
				<div className={ styles.assistantText } style={ { opacity: assistantOp } }>
					<StreamingText text={ reply } count={ replyLen } caretClassName={ styles.streamCaret } />
				</div>
				<span className={ styles.toolChip } style={ { opacity: toolOp } }>
					<FileGlyph />
					<span className={ styles.toolShimmer }>{ __( 'Reading' ) } front-page.php</span>
				</span>
			</div>
			<div className={ styles.composer } style={ { transform: `translateY(${ composerY }px)` } }>
				<div className={ styles.composerInput }>
					{ showPlaceholder ? (
						<span className={ styles.composerPlaceholder }>{ placeholder }</span>
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
