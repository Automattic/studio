import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
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
// (composer drops to the bottom and flips to its busy state while the prompt
// scales up into a user bubble), stream the reply, then show a tool call that
// keeps "reading" and a subtle Replay control. Theme-adaptive.
export function ChatIllustration() {
	const [ promptLen, setPromptLen ] = useState( 0 );
	const [ sent, setSent ] = useState( false );
	const [ replyLen, setReplyLen ] = useState( 0 );
	const [ showTool, setShowTool ] = useState( false );
	const [ showReplay, setShowReplay ] = useState( false );
	const timers = useRef< number[] >( [] );

	const prompt = __( 'Add a contact form to the homepage' );
	const reply = __(
		'Good idea! I’ll open the homepage and check to see where the best place would be for a contact form.'
	);

	const clearTimers = useCallback( () => {
		timers.current.forEach( ( id ) => window.clearTimeout( id ) );
		timers.current = [];
	}, [] );

	const run = useCallback( () => {
		clearTimers();
		setPromptLen( 0 );
		setSent( false );
		setReplyLen( 0 );
		setShowTool( false );
		setShowReplay( false );

		const at = ( fn: () => void, delay: number ) => {
			timers.current.push( window.setTimeout( fn, delay ) );
		};

		const reduce = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
		if ( reduce ) {
			setSent( true );
			setReplyLen( reply.length );
			setShowTool( true );
			setShowReplay( true );
			return;
		}

		const typeStart = 550;
		for ( let i = 1; i <= prompt.length; i++ ) {
			at( () => setPromptLen( i ), typeStart + i * TYPE_MS );
		}
		const sentAt = typeStart + prompt.length * TYPE_MS + 480;
		at( () => setSent( true ), sentAt );

		const streamStart = sentAt + 680;
		for ( let j = 1; j <= reply.length; j++ ) {
			at( () => setReplyLen( j ), streamStart + j * STREAM_MS );
		}
		const streamEnd = streamStart + reply.length * STREAM_MS;
		at( () => setShowTool( true ), streamEnd + 300 );
		at( () => setShowReplay( true ), streamEnd + 800 );
	}, [ clearTimers, prompt, reply ] );

	useEffect( () => {
		run();
		return clearTimers;
	}, [ run, clearTimers ] );

	const typing = ! sent && promptLen > 0;
	const streaming = sent && replyLen > 0 && replyLen < reply.length;
	const placeholder = sent
		? __( 'Queue the next message while I work…' )
		: __( 'What can Studio build today?' );
	const showPlaceholder = sent || promptLen === 0;

	return (
		<div className={ styles.chatScene }>
			<button
				type="button"
				className={ clsx( styles.replayButton, showReplay && styles.replayVisible ) }
				onClick={ run }
			>
				{ __( 'Replay' ) }
			</button>
			<div className={ styles.chatConversation }>
				<div className={ clsx( styles.userBubble, sent && styles.userBubbleVisible ) }>
					{ prompt }
				</div>
				<div className={ clsx( styles.assistantText, sent && styles.assistantVisible ) }>
					{ reply.slice( 0, replyLen ) }
					{ streaming ? <span className={ styles.streamCaret } /> : null }
				</div>
				<span className={ clsx( styles.toolChip, showTool && styles.toolChipVisible ) }>
					<FileGlyph />
					<span className={ styles.toolShimmer }>{ __( 'Reading' ) } front-page.php</span>
				</span>
			</div>
			<div className={ clsx( styles.composer, sent && styles.composerGone ) }>
				<div className={ styles.composerInput }>
					{ showPlaceholder ? (
						<span className={ styles.composerPlaceholder }>{ placeholder }</span>
					) : null }
					{ typing ? (
						<span className={ styles.composerTyped }>
							{ prompt.slice( 0, promptLen ) }
							<span className={ styles.composerCaret } />
						</span>
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
