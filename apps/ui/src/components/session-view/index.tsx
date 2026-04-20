import { isAssistantSdkMessage, isTextBlock, isToolUseBlock } from '@studio/common/ai/sdk-messages';
import { filterEventsAfterLastClear } from '@studio/common/ai/sessions/filter-events';
import { getToolDetail, getToolDisplayName } from '@studio/common/ai/tools';
import { __ } from '@wordpress/i18n';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Markdown } from '@/components/markdown';
import { SiteDropdown } from '@/components/site-dropdown';
import { useSession } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type { AiSessionEvent, AiSessionSummary, LoadedAiSession } from '@/data/core';

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

function eventsToRenderItems( events: AiSessionEvent[] ): RenderItem[] {
	const relevant = filterEventsAfterLastClear( events );
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
				event.message.message.content.forEach( ( block, blockIndex ) => {
					if ( isTextBlock( block ) ) {
						const text = block.text.trim();
						if ( text ) {
							items.push( {
								kind: 'assistant-text',
								key: `${ eventIndex }:${ blockIndex }:text`,
								text,
							} );
						}
					} else if ( isToolUseBlock( block ) ) {
						items.push( {
							kind: 'tool-use',
							key: `${ eventIndex }:${ blockIndex }:tool`,
							name: block.name,
							input: block.input,
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
	const { data: sites } = useSites();
	if ( ! siteName ) {
		return null;
	}

	const site = sites?.find( ( candidate ) => candidate.path === summary.ownerSitePath );

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
			{ site ? (
				<SiteDropdown site={ site } />
			) : (
				<>
					<span className={ styles.headerSite }>{ siteName }</span>
					<span className={ styles.headerDot } aria-hidden="true" />
					<span className={ styles.headerEnv }>{ __( 'Local' ) }</span>
				</>
			) }
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
	return <Markdown>{ text }</Markdown>;
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

	// Jump to the bottom when the session opens or changes. Run synchronously
	// before paint to avoid a flash at the top, and re-pin after the next
	// frame to catch late layout shifts (markdown finishing, fonts settling).
	useLayoutEffect( () => {
		const node = scrollRef.current;
		if ( ! node ) {
			return;
		}
		node.scrollTop = node.scrollHeight;
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
