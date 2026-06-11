import {
	isStudioChatArtifactData,
	type StudioChatArtifactData,
} from '@studio/common/ai/chat-artifacts';
import {
	isStudioCustomEntryOfType,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import {
	getToolDetail,
	getToolDisplayName,
	type NormalizedToolResult,
} from '@studio/common/ai/tools';
import { __, sprintf } from '@wordpress/i18n';
import { check, plus } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Markdown } from '@/components/markdown';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { createDeskWidget } from '@/ui-desks/widget-actions/create-widget';
import {
	SCRATCHPAD_WIDGET_TYPE,
	isScratchpadWidgetProps,
	type ScratchpadWidget,
	type ScratchpadWidgetProps,
} from '@/ui-desks/widgets/scratchpad/types';
import { ThinkingIndicator } from '../thinking-indicator';
import {
	getWidgetDisplayLabel,
	summarizeWidgetList,
	WidgetContextThumbnail,
	WidgetContextThumbnailList,
} from '../widget-context';
import styles from './style.module.css';
import type { LoadedAiSession } from '@/data/core';
import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

type RenderItem =
	| { kind: 'user-text'; key: string; text: string }
	| { kind: 'assistant-text'; key: string; text: string }
	| { kind: 'chat-artifact'; key: string; artifact: StudioChatArtifactData }
	| {
			kind: 'tool-use';
			key: string;
			name: string;
			input?: Record< string, unknown >;
			result?: NormalizedToolResult;
	  }
	| {
			kind: 'agent-question';
			key: string;
			question: string;
			options: Array< { label: string; description: string } >;
	  }
	| { kind: 'interrupted-marker'; key: string };

interface PiAssistantContentBlock {
	type: 'text' | 'toolCall' | 'thinking';
	text?: string;
	id?: string;
	name?: string;
	arguments?: Record< string, unknown >;
}

interface PiAssistantMessageLike {
	role: 'assistant';
	content: PiAssistantContentBlock[];
}

interface PiToolResultLike {
	role: 'toolResult';
	toolCallId: string;
	content?: Array< { type: string; text?: string } >;
	isError?: boolean;
}

const HIDDEN_TOOL_ROWS = new Set( [ 'studio_present' ] );

export function entriesToRenderItems( entries: SessionEntry[] ): RenderItem[] {
	const resultsByToolCallId = new Map< string, NormalizedToolResult >();
	for ( const entry of entries ) {
		if ( entry.type !== 'message' ) continue;
		const message = ( entry as { message?: unknown } ).message as PiToolResultLike | undefined;
		if ( ! message || message.role !== 'toolResult' ) continue;
		const text = ( message.content ?? [] )
			.filter( ( b ) => b.type === 'text' && typeof b.text === 'string' )
			.map( ( b ) => b.text as string )
			.join( '\n' );
		resultsByToolCallId.set( message.toolCallId, {
			text,
			isError: message.isError === true,
		} );
	}

	const items: RenderItem[] = [];
	entries.forEach( ( entry, entryIndex ) => {
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
			if ( ! data || data.source !== 'prompt' ) return;
			items.push( {
				kind: 'user-text',
				key: `${ entryIndex }:user`,
				text: data.text,
			} );
			return;
		}

		if ( entry.type === 'message' ) {
			const message = ( entry as { message?: unknown } ).message as
				| PiAssistantMessageLike
				| undefined;
			if ( ! message || message.role !== 'assistant' || ! Array.isArray( message.content ) ) {
				return;
			}
			message.content.forEach( ( block, blockIndex ) => {
				if ( block.type === 'text' && typeof block.text === 'string' ) {
					const text = block.text.trim();
					if ( text ) {
						items.push( {
							kind: 'assistant-text',
							key: `${ entryIndex }:${ blockIndex }:text`,
							text,
						} );
					}
				} else if (
					block.type === 'toolCall' &&
					typeof block.id === 'string' &&
					typeof block.name === 'string' &&
					! HIDDEN_TOOL_ROWS.has( block.name )
				) {
					items.push( {
						kind: 'tool-use',
						key: `${ entryIndex }:${ blockIndex }:tool`,
						name: block.name,
						input: ( block.arguments as Record< string, unknown > ) ?? {},
						result: resultsByToolCallId.get( block.id ),
					} );
				}
			} );
			return;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.chat_artifact' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.chat_artifact' > ).data;
			if ( ! isStudioChatArtifactData( data ) ) return;
			items.push( {
				kind: 'chat-artifact',
				key: `${ entryIndex }:artifact`,
				artifact: data,
			} );
			return;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.agent_question' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.agent_question' > ).data;
			if ( ! data ) return;
			items.push( {
				kind: 'agent-question',
				key: `${ entryIndex }:question`,
				question: data.question,
				options: data.options,
			} );
			return;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.turn_closed' > ).data;
			if ( data?.status === 'interrupted' ) {
				items.push( {
					kind: 'interrupted-marker',
					key: `${ entryIndex }:interrupted`,
				} );
			}
		}
	} );

	return items;
}

function findLatestProgressMessage( entries: SessionEntry[] ): string | null {
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		const entry = entries[ i ];
		if (
			isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ||
			isStudioCustomEntryOfType( entry, 'studio.turn_closed' )
		) {
			return null;
		}
		if ( isStudioCustomEntryOfType( entry, 'studio.tool_progress' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.tool_progress' > ).data;
			if ( data ) return data.message;
		}
	}
	return null;
}

function findLatestToolUseKey( items: RenderItem[] ): string | null {
	for ( let i = items.length - 1; i >= 0; i -= 1 ) {
		const item = items[ i ];
		if ( item.kind === 'tool-use' ) {
			return item.key;
		}
	}
	return null;
}

function UserMessage( { text }: { text: string } ) {
	return (
		<div className={ clsx( styles.messageGroup, styles.userGroup ) }>
			<div className={ clsx( styles.message, styles.userMessage ) }>{ text }</div>
		</div>
	);
}

function AssistantMessage( { text }: { text: string } ) {
	return (
		<div className={ clsx( styles.messageGroup, styles.assistantGroup ) }>
			<div className={ clsx( styles.message, styles.assistantMessage ) }>
				<Markdown className={ styles.assistantMarkdown }>{ text }</Markdown>
			</div>
		</div>
	);
}

const TOOL_RESULT_PREVIEW_MAX_LINES = 12;
const ARTIFACT_DRAG_THRESHOLD = 4;
const ARTIFACT_DRAG_SPACING = 32;

interface ArtifactDragState {
	widgets: DeskWidget[];
	x: number;
	y: number;
	isOverCanvas: boolean;
}

function ToolUseRow( {
	name,
	input,
	result,
}: {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
} ) {
	const label = getToolDisplayName( name );
	const detail = getToolDetail( name, input );
	const [ expanded, setExpanded ] = useState( false );
	const resultText = result?.text?.trim() ?? '';
	const hasOutput = resultText.length > 0;
	const isLong = resultText.split( '\n' ).length > TOOL_RESULT_PREVIEW_MAX_LINES;

	return (
		<div className={ clsx( styles.messageGroup, styles.assistantGroup ) }>
			<div className={ styles.toolBlock }>
				<div className={ styles.toolRow }>
					<span className={ styles.toolLabel }>{ label }</span>
					{ detail ? <span className={ styles.toolDetail }>{ detail }</span> : null }
				</div>
				{ hasOutput ? (
					<div className={ styles.toolOutputWrap }>
						<pre
							className={ clsx(
								styles.toolOutput,
								result?.isError && styles.toolOutputError,
								! expanded && isLong && styles.toolOutputCollapsed
							) }
						>
							{ resultText }
						</pre>
						{ isLong ? (
							<Button
								variant="quiet"
								size="xsmall"
								className={ styles.toolOutputToggle }
								label={ expanded ? __( 'Show less' ) : __( 'Show more' ) }
								onClick={ () => setExpanded( ( prev ) => ! prev ) }
							>
								{ expanded ? __( 'Show less' ) : __( 'Show more' ) }
							</Button>
						) : null }
					</div>
				) : null }
			</div>
		</div>
	);
}

export function ChatArtifact( { artifact }: { artifact: StudioChatArtifactData } ) {
	const { addWidget, addWidgetAtScreenPoint, canAddWidgets } = useDesk();
	const [ addedWidgetIds, setAddedWidgetIds ] = useState< ReadonlySet< string > >(
		() => new Set()
	);
	const [ dragState, setDragState ] = useState< ArtifactDragState | null >( null );
	const widgets = useMemo(
		() =>
			artifact.widgets
				.map( ( widget, index ) =>
					createDeskWidget( {
						id: `${ artifact.id }-${ index }`,
						type: widget.type,
						center: { x: 0, y: 0 },
						zIndex: 'a1',
						shapeProps: widget.shapeProps,
						widgetProps: normalizeChatArtifactWidgetProps( widget.type, widget.widgetProps ),
					} )
				)
				.filter( ( widget ): widget is DeskWidget => widget !== null ),
		[ artifact ]
	);

	if ( widgets.length === 0 ) {
		return null;
	}

	const summary = summarizeWidgetList( widgets );
	const allAdded = widgets.every( ( widget ) => addedWidgetIds.has( widget.id ) );
	const hasAddedSome = widgets.some( ( widget ) => addedWidgetIds.has( widget.id ) );
	const scratchpadWidget =
		widgets.length === 1 && isScratchpadWidget( widgets[ 0 ] ) ? widgets[ 0 ] : null;
	const markWidgetsAdded = ( widgetIds: string[] ) => {
		if ( widgetIds.length === 0 ) {
			return;
		}

		setAddedWidgetIds( ( previousIds ) => {
			const nextIds = new Set( previousIds );
			widgetIds.forEach( ( widgetId ) => nextIds.add( widgetId ) );
			return nextIds;
		} );
	};
	const insertWidgetOnCanvas = ( widget: DeskWidget, screenPoint?: { x: number; y: number } ) => {
		const options = {
			shapeProps: widget.shapeProps,
			widgetProps: widget.widgetProps,
			shouldStartEditing: false,
		};
		if ( screenPoint ) {
			return addWidgetAtScreenPoint( widget.type, screenPoint, options );
		}

		return addWidget( widget.type, options );
	};
	const addWidgetToCanvas = ( widget: DeskWidget, screenPoint?: { x: number; y: number } ) => {
		if ( addedWidgetIds.has( widget.id ) ) {
			return false;
		}

		const didAdd = insertWidgetOnCanvas( widget, screenPoint );
		if ( didAdd ) {
			markWidgetsAdded( [ widget.id ] );
		}
		return didAdd;
	};
	const addWidgetsToCanvas = ( screenPoint?: { x: number; y: number } ) => {
		const addedIds: string[] = [];
		widgets.forEach( ( widget, index ) => {
			if ( addedWidgetIds.has( widget.id ) ) {
				return;
			}

			const didAdd = insertWidgetOnCanvas(
				widget,
				screenPoint
					? {
							x: screenPoint.x + index * ARTIFACT_DRAG_SPACING,
							y: screenPoint.y,
					  }
					: undefined
			);
			if ( didAdd ) {
				addedIds.push( widget.id );
			}
		} );
		markWidgetsAdded( addedIds );
		return addedIds.length > 0;
	};

	const handlePointerDown = ( event: ReactPointerEvent< HTMLDivElement > ) => {
		const draggableWidgets = widgets.filter( ( widget ) => ! addedWidgetIds.has( widget.id ) );
		if (
			event.button !== 0 ||
			! canAddWidgets ||
			draggableWidgets.length === 0 ||
			isInteractiveArtifactTarget( event.target )
		) {
			return;
		}

		event.preventDefault();

		const pointerId = event.pointerId;
		const startX = event.clientX;
		const startY = event.clientY;
		let didStartDrag = false;

		const cleanup = () => {
			window.removeEventListener( 'pointermove', handlePointerMove, true );
			window.removeEventListener( 'pointerup', handlePointerUp, true );
			window.removeEventListener( 'pointercancel', handlePointerCancel, true );
			setDragState( null );
		};

		const syncDragState = ( pointerEvent: PointerEvent ) => {
			setDragState( {
				widgets: draggableWidgets,
				x: pointerEvent.clientX,
				y: pointerEvent.clientY,
				isOverCanvas: isCanvasDropTargetAtPoint( pointerEvent.clientX, pointerEvent.clientY ),
			} );
		};

		const handlePointerMove = ( pointerEvent: PointerEvent ) => {
			if ( pointerEvent.pointerId !== pointerId ) {
				return;
			}

			if ( ! didStartDrag ) {
				const distance = Math.hypot( pointerEvent.clientX - startX, pointerEvent.clientY - startY );
				if ( distance < ARTIFACT_DRAG_THRESHOLD ) {
					return;
				}
				didStartDrag = true;
			}

			syncDragState( pointerEvent );
			pointerEvent.preventDefault();
		};

		const handlePointerUp = ( pointerEvent: PointerEvent ) => {
			if ( pointerEvent.pointerId !== pointerId ) {
				return;
			}

			const shouldDrop =
				didStartDrag && isCanvasDropTargetAtPoint( pointerEvent.clientX, pointerEvent.clientY );
			if ( shouldDrop ) {
				addWidgetsToCanvas( { x: pointerEvent.clientX, y: pointerEvent.clientY } );
				pointerEvent.preventDefault();
			}
			cleanup();
		};

		const handlePointerCancel = ( pointerEvent: PointerEvent ) => {
			if ( pointerEvent.pointerId === pointerId ) {
				cleanup();
			}
		};

		window.addEventListener( 'pointermove', handlePointerMove, true );
		window.addEventListener( 'pointerup', handlePointerUp, true );
		window.addEventListener( 'pointercancel', handlePointerCancel, true );
	};

	return (
		<div className={ clsx( styles.messageGroup, styles.assistantGroup ) }>
			{ scratchpadWidget ? (
				<ScratchpadArtifactCard
					widget={ scratchpadWidget }
					isAdded={ allAdded }
					canAddWidgets={ canAddWidgets }
					onAdd={ () => addWidgetToCanvas( scratchpadWidget ) }
					onPointerDown={ handlePointerDown }
				/>
			) : (
				<>
					<div
						className={ styles.artifact }
						data-dragging={ dragState ? 'true' : undefined }
						onPointerDown={ handlePointerDown }
						title={ summary }
					>
						<div className={ styles.artifactThumbnails } aria-label={ summary }>
							{ widgets.map( ( widget, index ) => {
								const isAdded = addedWidgetIds.has( widget.id );
								const widgetLabel = getWidgetDisplayLabel( widget );
								const addLabel = getWidgetAddActionLabel( widget, index, isAdded );
								return (
									<div
										key={ widget.id }
										className={ styles.artifactThumbnail }
										aria-label={ widgetLabel }
										title={ widgetLabel }
									>
										<WidgetContextThumbnail widget={ widget } />
										{ widgets.length > 1 && (
											<button
												type="button"
												className={ styles.artifactThumbnailAdd }
												disabled={ ! canAddWidgets || isAdded }
												data-added={ isAdded ? 'true' : undefined }
												title={ addLabel }
												aria-label={ addLabel }
												onClick={ ( event ) => {
													event.stopPropagation();
													addWidgetToCanvas( widget );
												} }
											>
												<Icon icon={ isAdded ? check : plus } size={ 14 } />
											</button>
										) }
									</div>
								);
							} ) }
						</div>
					</div>
					<div className={ styles.artifactActions }>
						{ widgets.length > 1 ? (
							<button
								type="button"
								className={ styles.artifactAction }
								disabled={ ! canAddWidgets || allAdded }
								title={ summary }
								onClick={ () => addWidgetsToCanvas() }
							>
								<Icon icon={ plus } size={ 16 } />
								<span>
									{ allAdded
										? __( 'Added all' )
										: hasAddedSome
										? __( 'Add remaining' )
										: __( 'Add all' ) }
								</span>
							</button>
						) : (
							<button
								type="button"
								className={ styles.artifactAction }
								disabled={ ! canAddWidgets || allAdded }
								title={ summary }
								onClick={ () => addWidgetToCanvas( widgets[ 0 ] ) }
							>
								<Icon icon={ plus } size={ 16 } />
								<span>{ allAdded ? __( 'Added' ) : __( 'Add to canvas' ) }</span>
							</button>
						) }
					</div>
				</>
			) }
			{ dragState && typeof document !== 'undefined'
				? createPortal( <ArtifactDragOverlay state={ dragState } />, document.body )
				: null }
		</div>
	);
}

function ScratchpadArtifactCard( {
	widget,
	isAdded,
	canAddWidgets,
	onAdd,
	onPointerDown,
}: {
	widget: ScratchpadWidget;
	isAdded: boolean;
	canAddWidgets: boolean;
	onAdd: () => void;
	onPointerDown: ( event: ReactPointerEvent< HTMLDivElement > ) => void;
} ) {
	const title = widget.widgetProps.title || __( 'Scratchpad' );
	const description = widget.widgetProps.description?.trim();

	return (
		<>
			<div
				className={ styles.scratchpadArtifact }
				data-scope={ widget.widgetProps.scope }
				onPointerDown={ onPointerDown }
				title={ getWidgetDisplayLabel( widget ) }
			>
				<div className={ styles.scratchpadArtifactBody }>
					<span className={ styles.scratchpadArtifactTitle }>{ title }</span>
					{ description ? (
						<p className={ styles.scratchpadArtifactDescription }>{ description }</p>
					) : null }
				</div>
				<div className={ styles.scratchpadArtifactThumbnail }>
					<iframe
						className={ styles.scratchpadArtifactFrame }
						srcDoc={ widget.widgetProps.html }
						sandbox="allow-scripts"
						referrerPolicy="no-referrer"
						title={ title }
					/>
					<div className={ styles.scratchpadArtifactShield } aria-hidden="true" />
				</div>
			</div>
			<div className={ styles.artifactActions }>
				<button
					type="button"
					className={ styles.artifactAction }
					disabled={ ! canAddWidgets || isAdded }
					title={ getWidgetDisplayLabel( widget ) }
					onClick={ onAdd }
				>
					<Icon icon={ plus } size={ 16 } />
					<span>{ isAdded ? __( 'Added' ) : __( 'Add to canvas' ) }</span>
				</button>
			</div>
		</>
	);
}

function normalizeChatArtifactWidgetProps(
	type: string,
	widgetProps: Record< string, unknown >
): Record< string, unknown > {
	if ( type !== SCRATCHPAD_WIDGET_TYPE || ! isScratchpadWidgetProps( widgetProps ) ) {
		return widgetProps;
	}

	return normalizeScratchpadArtifactWidgetProps( widgetProps );
}

function normalizeScratchpadArtifactWidgetProps(
	widgetProps: ScratchpadWidgetProps
): ScratchpadWidgetProps {
	const description = widgetProps.description ?? '';
	return {
		...widgetProps,
		agentStatus: widgetProps.agentStatus ?? 'idle',
		lastSyncedDescription: widgetProps.lastSyncedDescription ?? description,
	};
}

function isScratchpadWidget( widget: DeskWidget ): widget is ScratchpadWidget {
	return widget.type === SCRATCHPAD_WIDGET_TYPE && isScratchpadWidgetProps( widget.widgetProps );
}

function getWidgetAddActionLabel( widget: DeskWidget, index: number, isAdded: boolean ) {
	const widgetLabel = getWidgetDisplayLabel( widget );
	return isAdded
		? sprintf(
				/* translators: 1: widget number in the artifact, 2: widget label. */
				__( 'Added widget %1$d to canvas: %2$s' ),
				index + 1,
				widgetLabel
		  )
		: sprintf(
				/* translators: 1: widget number in the artifact, 2: widget label. */
				__( 'Add widget %1$d to canvas: %2$s' ),
				index + 1,
				widgetLabel
		  );
}

function ArtifactDragOverlay( { state }: { state: ArtifactDragState } ) {
	return (
		<div
			className={ styles.artifactDragOverlay }
			data-over={ state.isOverCanvas ? 'canvas' : 'chat' }
			style={ {
				left: state.x,
				top: state.y,
			} }
		>
			<div className={ styles.artifactDragOverlayInner }>
				<WidgetContextThumbnailList
					widgets={ state.widgets }
					ariaLabel={ __( 'Dragged artifact' ) }
				/>
			</div>
		</div>
	);
}

function isCanvasDropTargetAtPoint( x: number, y: number ) {
	const element = document.elementFromPoint( x, y );
	return Boolean( element?.closest( '[data-ui-desks-canvas]' ) );
}

function isInteractiveArtifactTarget( target: EventTarget | null ) {
	return Boolean( ( target as HTMLElement | null )?.closest( 'button,a,input,textarea,select' ) );
}

function AgentQuestion( {
	question,
	options,
	isInteractive,
	pickedLabel,
	onAnswer,
}: {
	question: string;
	options: Array< { label: string; description: string } >;
	isInteractive: boolean;
	pickedLabel: string | undefined;
	onAnswer: ( label: string ) => void;
} ) {
	return (
		<div className={ clsx( styles.messageGroup, styles.assistantGroup ) }>
			<div className={ styles.question }>
				<p className={ styles.questionText }>{ question }</p>
				{ options.length > 0 ? (
					<ul className={ styles.questionOptions }>
						{ options.map( ( option, index ) => {
							const picked = option.label === pickedLabel;
							return (
								<li key={ index }>
									<Button
										variant="quiet"
										size="xsmall"
										className={ clsx(
											styles.questionOption,
											picked && styles.questionOptionPicked
										) }
										label={ option.label }
										disabled={ ! isInteractive }
										onClick={ () => onAnswer( option.label ) }
										title={ option.description }
									>
										{ option.label }
									</Button>
								</li>
							);
						} ) }
					</ul>
				) : null }
			</div>
		</div>
	);
}

export function Conversation( {
	data,
	isRunning,
	startedAt,
	pendingQuestions,
	pendingAnswers,
	onAnswerQuestion,
}: {
	data: LoadedAiSession;
	isRunning: boolean;
	startedAt: number | null;
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	onAnswerQuestion: ( question: string, label: string ) => void;
} ) {
	const entries = data.entries;
	const items = useMemo( () => entriesToRenderItems( entries ), [ entries ] );
	const progressMessage = useMemo(
		() => ( isRunning ? findLatestProgressMessage( entries ) : null ),
		[ entries, isRunning ]
	);
	const thinkingMessageKey = useMemo( () => findLatestToolUseKey( items ), [ items ] );

	return (
		<div className={ styles.root }>
			{ items.map( ( item ) => {
				switch ( item.kind ) {
					case 'user-text':
						return <UserMessage key={ item.key } text={ item.text } />;
					case 'assistant-text':
						return <AssistantMessage key={ item.key } text={ item.text } />;
					case 'chat-artifact':
						return <ChatArtifact key={ item.key } artifact={ item.artifact } />;
					case 'tool-use':
						return (
							<ToolUseRow
								key={ item.key }
								name={ item.name }
								input={ item.input }
								result={ item.result }
							/>
						);
					case 'agent-question':
						return (
							<AgentQuestion
								key={ item.key }
								question={ item.question }
								options={ item.options }
								isInteractive={ pendingQuestions.has( item.question ) }
								pickedLabel={ pendingAnswers[ item.question ] }
								onAnswer={ ( label ) => onAnswerQuestion( item.question, label ) }
							/>
						);
					case 'interrupted-marker':
						return (
							<div key={ item.key } className={ styles.interruptedMarker } role="status">
								{ __( 'Interrupted by you' ) }
							</div>
						);
					default:
						return null;
				}
			} ) }
			<div className={ styles.thinking }>
				<ThinkingIndicator
					active={ isRunning && pendingQuestions.size === 0 }
					startedAt={ startedAt }
					messageKey={ thinkingMessageKey }
					progressMessage={ progressMessage }
				/>
			</div>
		</div>
	);
}
