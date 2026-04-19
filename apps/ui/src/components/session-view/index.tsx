import { __ } from '@wordpress/i18n';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Markdown } from '@/components/markdown';
import { useSession } from '@/data/queries/use-sessions';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type { AiSessionEvent, AiSessionSummary, LoadedAiSession } from '@/data/core';

type TextBlock = { type: 'text'; text: string };
type ToolUseBlock = {
	type: 'tool_use';
	id: string;
	name: string;
	input?: Record< string, unknown >;
};
type ContentBlock = TextBlock | ToolUseBlock | { type: string };

type AssistantSdkMessage = {
	type: 'assistant';
	message: { content: ContentBlock[] };
};

type RenderItem =
	| { kind: 'user-text'; key: string; text: string }
	| { kind: 'assistant-text'; key: string; text: string }
	| { kind: 'tool-use'; key: string; name: string; input?: Record< string, unknown > }
	| { kind: 'tool-progress'; key: string; message: string }
	| {
			kind: 'agent-question';
			key: string;
			question: string;
			options: Array< { label: string; description: string } >;
	  };

const TOOL_DISPLAY_NAMES: Record< string, string > = {
	mcp__studio__site_create: 'create site',
	mcp__studio__site_list: 'list sites',
	mcp__studio__site_info: 'site info',
	mcp__studio__site_start: 'start site',
	mcp__studio__site_stop: 'stop site',
	mcp__studio__site_delete: 'delete site',
	mcp__studio__wp_cli: 'wp',
	mcp__studio__take_screenshot: 'screenshot',
	mcp__studio__validate_blocks: 'validate',
	Read: 'read',
	Write: 'write',
	Edit: 'edit',
	Bash: 'run',
	Glob: 'search',
	Grep: 'search',
	Skill: 'skill',
	Task: 'task',
	TodoWrite: 'todos',
	WebFetch: 'fetch',
	WebSearch: 'search',
};

function getToolDisplayName( name: string ): string {
	return TOOL_DISPLAY_NAMES[ name ] ?? name;
}

function getToolDetail( name: string, input?: Record< string, unknown > ): string {
	if ( ! input ) {
		return '';
	}
	switch ( name ) {
		case 'Read':
		case 'Write':
		case 'Edit': {
			const filePath = input.file_path ?? input.path;
			if ( typeof filePath === 'string' ) {
				return filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return '';
		}
		case 'Bash':
			return typeof input.command === 'string' ? input.command : '';
		case 'Grep':
		case 'Glob':
			return typeof input.pattern === 'string' ? input.pattern : '';
		case 'Skill':
			return typeof input.skill === 'string' ? input.skill : '';
		case 'mcp__studio__wp_cli':
			return typeof input.command === 'string' ? input.command : '';
		case 'mcp__studio__site_info':
		case 'mcp__studio__site_start':
		case 'mcp__studio__site_stop':
		case 'mcp__studio__site_delete':
			return typeof input.nameOrPath === 'string' ? input.nameOrPath : '';
		default:
			return '';
	}
}

function isAssistantSdkMessage( value: unknown ): value is AssistantSdkMessage {
	if ( ! value || typeof value !== 'object' ) {
		return false;
	}
	const outer = value as { type?: unknown; message?: unknown };
	if ( outer.type !== 'assistant' ) {
		return false;
	}
	const inner = outer.message as { content?: unknown } | undefined;
	return !! inner && Array.isArray( inner.content );
}

function eventsToRenderItems( events: AiSessionEvent[] ): RenderItem[] {
	// Honor session.cleared by dropping anything emitted before the last clear.
	let lastClearedIndex = -1;
	for ( let i = events.length - 1; i >= 0; i-- ) {
		if ( events[ i ].type === 'session.cleared' ) {
			lastClearedIndex = i;
			break;
		}
	}
	const relevant = lastClearedIndex >= 0 ? events.slice( lastClearedIndex + 1 ) : events;

	const items: RenderItem[] = [];

	relevant.forEach( ( event, eventIndex ) => {
		switch ( event.type ) {
			case 'user.message': {
				if ( event.source !== 'prompt' ) {
					return;
				}
				items.push( {
					kind: 'user-text',
					key: `${ eventIndex }:user`,
					text: event.text,
				} );
				return;
			}
			case 'sdk.message': {
				if ( ! isAssistantSdkMessage( event.message ) ) {
					return;
				}
				const content = event.message.message.content;
				content.forEach( ( block, blockIndex ) => {
					if ( block.type === 'text' ) {
						const text = ( block as TextBlock ).text?.trim();
						if ( text ) {
							items.push( {
								kind: 'assistant-text',
								key: `${ eventIndex }:${ blockIndex }:text`,
								text,
							} );
						}
					} else if ( block.type === 'tool_use' ) {
						const use = block as ToolUseBlock;
						items.push( {
							kind: 'tool-use',
							key: `${ eventIndex }:${ blockIndex }:tool`,
							name: use.name,
							input: use.input,
						} );
					}
				} );
				return;
			}
			case 'tool.progress': {
				items.push( {
					kind: 'tool-progress',
					key: `${ eventIndex }:progress`,
					message: event.message,
				} );
				return;
			}
			case 'agent.question': {
				items.push( {
					kind: 'agent-question',
					key: `${ eventIndex }:question`,
					question: event.question,
					options: event.options,
				} );
				return;
			}
			default:
				return;
		}
	} );

	return items;
}

function SessionHeader( { summary }: { summary: AiSessionSummary } ) {
	const siteName = summary.ownerSiteName;
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	if ( ! siteName ) {
		return null;
	}

	// When the sidebar is collapsed the floating toggle button lives in the
	// main area. Reserve a no-drag spacer at the left so the header's drag
	// region doesn't sit under the button (Electron's drag-region stacking
	// is unreliable when drag sits beneath a no-drag overlay).
	const toggleSpacerClass = sidebarCollapsed
		? isFullscreen
			? styles.toggleSpacerFullscreen
			: styles.toggleSpacer
		: null;

	return (
		<div className={ styles.header }>
			{ toggleSpacerClass ? <span className={ toggleSpacerClass } aria-hidden="true" /> : null }
			<span className={ styles.headerSite }>{ siteName }</span>
			<span className={ styles.headerDot } aria-hidden="true" />
			<span className={ styles.headerEnv }>{ __( 'Local' ) }</span>
		</div>
	);
}

function UserTurn( { text }: { text: string } ) {
	return (
		<div className={ styles.userTurn }>
			<div className={ styles.userText }>{ text }</div>
		</div>
	);
}

function AssistantText( { text }: { text: string } ) {
	return (
		<div className={ styles.turn }>
			<Markdown>{ text }</Markdown>
		</div>
	);
}

function ToolUseRow( { name, input }: { name: string; input?: Record< string, unknown > } ) {
	const label = getToolDisplayName( name );
	const detail = getToolDetail( name, input );
	return (
		<div className={ styles.toolRow }>
			<span className={ styles.toolLabel }>{ label }</span>
			{ detail ? <span className={ styles.toolDetail }>{ detail }</span> : null }
		</div>
	);
}

function ToolProgressRow( { message }: { message: string } ) {
	return (
		<div className={ styles.toolRow }>
			<span className={ styles.toolLabel }>{ __( 'working' ) }</span>
			<span className={ styles.toolDetail }>{ message }</span>
		</div>
	);
}

function AgentQuestion( {
	question,
	options,
}: {
	question: string;
	options: Array< { label: string; description: string } >;
} ) {
	return (
		<div className={ styles.question }>
			<p className={ styles.questionText }>{ question }</p>
			{ options.length > 0 ? (
				<ul className={ styles.questionOptions }>
					{ options.map( ( option, index ) => (
						<li key={ index }>
							<button type="button" className={ styles.questionOption }>
								{ option.label }
							</button>
						</li>
					) ) }
				</ul>
			) : null }
		</div>
	);
}

function Conversation( { data }: { data: LoadedAiSession } ) {
	const items = useMemo( () => eventsToRenderItems( data.events ), [ data.events ] );

	return (
		<div className={ styles.conversation }>
			{ items.map( ( item ) => {
				switch ( item.kind ) {
					case 'user-text':
						return <UserTurn key={ item.key } text={ item.text } />;
					case 'assistant-text':
						return <AssistantText key={ item.key } text={ item.text } />;
					case 'tool-use':
						return <ToolUseRow key={ item.key } name={ item.name } input={ item.input } />;
					case 'tool-progress':
						return <ToolProgressRow key={ item.key } message={ item.message } />;
					case 'agent-question':
						return (
							<AgentQuestion key={ item.key } question={ item.question } options={ item.options } />
						);
					default:
						return null;
				}
			} ) }
		</div>
	);
}

function Composer() {
	return (
		<div className={ styles.composer }>
			<div className={ styles.composerInner }>
				<div className={ styles.composerInput }>{ __( 'Set your next instruction…' ) }</div>
			</div>
		</div>
	);
}

export function SessionView( { sessionId }: { sessionId: string } ) {
	const { data, isLoading, error } = useSession( sessionId );
	const scrollRef = useRef< HTMLDivElement >( null );

	// Jump to the bottom on first render for this session, before paint so the
	// scroll lands on the latest message without a visible flash.
	useLayoutEffect( () => {
		const node = scrollRef.current;
		if ( node ) {
			node.scrollTop = node.scrollHeight;
		}
	}, [ sessionId, data ] );

	// Scrollable content can also grow after the initial paint (e.g. markdown
	// finishing render, images loading). Re-pin to the bottom briefly after
	// mount so those late layout shifts don't leave the user mid-scroll.
	useEffect( () => {
		const node = scrollRef.current;
		if ( ! node ) {
			return;
		}
		const id = requestAnimationFrame( () => {
			node.scrollTop = node.scrollHeight;
		} );
		return () => cancelAnimationFrame( id );
	}, [ sessionId, data ] );

	if ( isLoading ) {
		return <div className={ styles.state }>{ __( 'Loading session…' ) }</div>;
	}

	if ( error || ! data ) {
		return (
			<div className={ styles.state }>
				<h1>{ __( 'Session not found' ) }</h1>
				<p>{ sessionId }</p>
			</div>
		);
	}

	return (
		<div className={ styles.root }>
			<SessionHeader summary={ data.summary } />
			<div ref={ scrollRef } className={ styles.scroll }>
				<Conversation data={ data } />
			</div>
			<Composer />
		</div>
	);
}
