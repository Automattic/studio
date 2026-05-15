import { __, sprintf } from '@wordpress/i18n';
import { blockDefault, check, cog, page, redo, reusableBlock } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditor } from 'tldraw';
import { useConnector } from '@/data/core';
import { useChats } from '@/ui-desks/chats/context';
import { focusOnDeskShape, useIncomingWidgetConnections } from '@/ui-desks/connectors/context';
import {
	SCRATCHPAD_WIDGET_TYPE,
	type ScratchpadAgentStatus,
	type ScratchpadScope,
	type ScratchpadWidgetProps,
} from '../types';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type ScratchpadWidgetComponentProps = DeskWidgetComponentProps< ScratchpadWidgetProps >;

export function ScratchpadWidgetComponent( {
	id,
	shapeId,
	widgetProps,
	isEditing,
	isHovered,
	isSelected,
	onWidgetPropsChange,
	onEditComplete,
}: ScratchpadWidgetComponentProps ) {
	const editor = useEditor();
	const connector = useConnector();
	const { startChatWithPrompt } = useChats();
	const descriptionRef = useRef< HTMLDivElement | null >( null );
	const widgetPropsRef = useRef( widgetProps );
	const labelVisible = isHovered || isSelected || isEditing;
	const isInteractive = isEditing;
	const description = widgetProps.description ?? '';
	const connectionSources = useIncomingWidgetConnections( editor, shapeId );
	const lastSyncedDescription = widgetProps.lastSyncedDescription ?? description;
	const agentStatus = widgetProps.agentStatus ?? 'idle';

	useEffect( () => {
		widgetPropsRef.current = widgetProps;
	}, [ widgetProps ] );

	const patchWidgetProps = useCallback(
		( patch: Partial< ScratchpadWidgetProps > ) => {
			const nextWidgetProps = {
				...widgetPropsRef.current,
				...patch,
			};
			widgetPropsRef.current = nextWidgetProps;
			onWidgetPropsChange( nextWidgetProps );
		},
		[ onWidgetPropsChange ]
	);

	useEffect( () => {
		const descriptionElement = descriptionRef.current;
		if ( ! descriptionElement || document.activeElement === descriptionElement ) {
			return;
		}

		if ( descriptionElement.textContent !== description ) {
			descriptionElement.textContent = description;
		}
	}, [ description ] );

	useEffect( () => {
		if ( ! isEditing ) {
			return;
		}

		const frame = window.requestAnimationFrame( () => {
			const description = descriptionRef.current;
			if ( ! description ) {
				return;
			}

			description.focus();
			const range = document.createRange();
			range.selectNodeContents( description );
			range.collapse( false );
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange( range );
		} );

		return () => {
			window.cancelAnimationFrame( frame );
		};
	}, [ isEditing ] );

	useEffect( () => {
		if ( agentStatus !== 'running' || ! widgetProps.agentSessionId ) {
			return;
		}

		return connector.onAgentEvent( ( payload ) => {
			if ( payload.sessionId !== widgetProps.agentSessionId ) {
				return;
			}

			if ( payload.event.type === 'run.exited' ) {
				const liveDescription =
					descriptionRef.current?.textContent ?? widgetPropsRef.current.description ?? '';
				patchWidgetProps(
					payload.event.status === 'success'
						? {
								agentStatus: 'done',
								lastSyncedDescription: liveDescription,
						  }
						: { agentStatus: 'pending' }
				);
			} else if ( payload.event.type === 'run.interrupted' ) {
				patchWidgetProps( { agentStatus: 'pending' } );
			}
		} );
	}, [ agentStatus, connector, patchWidgetProps, widgetProps.agentSessionId ] );

	const updateDescription = useCallback( () => {
		const nextDescription = descriptionRef.current?.textContent ?? '';
		if ( agentStatus === 'running' ) {
			patchWidgetProps( { description: nextDescription } );
			return;
		}

		patchWidgetProps( {
			description: nextDescription,
			agentStatus: getNextAgentStatusForDescription(
				nextDescription,
				lastSyncedDescription,
				agentStatus
			),
		} );
	}, [ agentStatus, lastSyncedDescription, patchWidgetProps ] );

	const handleRunAgent = useCallback( async () => {
		if ( agentStatus !== 'pending' ) {
			return;
		}

		const nextDescription = descriptionRef.current?.textContent ?? description;
		const runningProps: ScratchpadWidgetProps = {
			...widgetPropsRef.current,
			description: nextDescription,
			agentStatus: 'running',
		};
		patchWidgetProps( runningProps );

		try {
			const sessionId = await startChatWithPrompt( {
				prompt: buildScratchpadAgentPrompt( id, runningProps ),
				displayMessage: buildScratchpadAgentDisplayMessage( runningProps ),
			} );
			patchWidgetProps( { agentSessionId: sessionId } );
		} catch {
			patchWidgetProps( { agentStatus: 'pending' } );
		}
	}, [ agentStatus, description, id, patchWidgetProps, startChatWithPrompt ] );

	const handleDescriptionPointerDown = useCallback(
		( event: PointerEvent< HTMLDivElement > ) => {
			if ( isEditing ) {
				event.stopPropagation();
			}
		},
		[ isEditing ]
	);

	const handleDescriptionKeyDown = useCallback(
		( event: KeyboardEvent< HTMLDivElement > ) => {
			event.stopPropagation();
			if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
				event.preventDefault();
				onEditComplete();
			}
		},
		[ onEditComplete ]
	);
	const activeAgentStatus = agentStatus === 'idle' ? null : agentStatus;

	return (
		<div
			className={ styles.scratchpad }
			data-scope={ widgetProps.scope }
			data-agent-status={ agentStatus }
			data-is-editing={ isEditing ? 'true' : 'false' }
			data-studio-desk-widget={ SCRATCHPAD_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			{ widgetProps.title && (
				<div
					className={ styles.title }
					data-visible={ labelVisible ? 'true' : 'false' }
					title={ widgetProps.title }
				>
					{ widgetProps.title }
				</div>
			) }
			{ widgetProps.html ? (
				<iframe
					className={ styles.frame }
					title={ widgetProps.title || __( 'Scratchpad' ) }
					srcDoc={ widgetProps.html }
					sandbox="allow-scripts"
					referrerPolicy="no-referrer"
					draggable={ false }
					tabIndex={ isInteractive ? 0 : -1 }
					style={ {
						pointerEvents: isInteractive ? 'auto' : 'none',
					} }
				/>
			) : widgetProps.reference ? (
				<img
					className={ styles.reference }
					src={ widgetProps.reference.url }
					alt={ widgetProps.reference.alt }
					draggable={ false }
				/>
			) : (
				<div className={ styles.empty }>{ __( 'Empty scratchpad' ) }</div>
			) }
			<div className={ styles.bottom }>
				<div className={ styles.descriptionWrap }>
					<div
						ref={ descriptionRef }
						className={ styles.description }
						contentEditable={ isEditing }
						suppressContentEditableWarning
						spellCheck={ false }
						data-empty={ description ? 'false' : 'true' }
						data-placeholder={ __( 'Describe what this scratchpad should become...' ) }
						onBlur={ () => {
							updateDescription();
							onEditComplete();
						} }
						onInput={ updateDescription }
						onKeyDown={ handleDescriptionKeyDown }
						onPointerDown={ handleDescriptionPointerDown }
					/>
					{ connectionSources.length > 0 && (
						<div className={ styles.using } aria-label="Connected sources">
							<span className={ styles.usingLabel }>Using</span>
							{ connectionSources.map( ( source ) => (
								<button
									key={ source.shapeId }
									type="button"
									className={ styles.usingPill }
									title={ source.title }
									style={ source.pillBg ? { background: source.pillBg, color: '#fff' } : undefined }
									onClick={ () => focusOnDeskShape( editor, source.shapeId ) }
									onPointerDown={ ( event ) => event.stopPropagation() }
								>
									{ source.label }
								</button>
							) ) }
							<span className={ styles.usingPeriod } aria-hidden="true">
								.
							</span>
						</div>
					) }
				</div>
				{ activeAgentStatus && (
					<button
						type="button"
						className={ styles.statusButton }
						data-status={ activeAgentStatus }
						disabled={ activeAgentStatus === 'running' || activeAgentStatus === 'done' }
						aria-label={ SCRATCHPAD_STATUS_LABEL[ activeAgentStatus ] }
						title={ SCRATCHPAD_STATUS_LABEL[ activeAgentStatus ] }
						onClick={ handleRunAgent }
						onPointerDown={ ( event ) => event.stopPropagation() }
					>
						<Icon icon={ SCRATCHPAD_STATUS_ICON[ activeAgentStatus ] } size={ 20 } />
					</button>
				) }
			</div>
			{ ! isInteractive && <div className={ styles.shield } aria-hidden="true" /> }
		</div>
	);
}

export function ScratchpadWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< ScratchpadWidgetProps > ) {
	return (
		<div
			className={ styles.thumbnail }
			data-studio-desk-widget={ SCRATCHPAD_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<Icon icon={ getScratchpadScopeIcon( widgetProps.scope ) } size={ 24 } />
			<div className={ styles.thumbnailTitle }>{ widgetProps.title || __( 'Scratchpad' ) }</div>
		</div>
	);
}

function getScratchpadScopeIcon( scope: ScratchpadScope ) {
	switch ( scope ) {
		case 'page':
			return page;
		case 'pattern':
			return reusableBlock;
		case 'block':
			return blockDefault;
	}
}

const SCRATCHPAD_STATUS_ICON = {
	pending: redo,
	running: cog,
	done: check,
} as const;

const SCRATCHPAD_STATUS_LABEL: Record< Exclude< ScratchpadAgentStatus, 'idle' >, string > = {
	pending: __( 'Run agent on this' ),
	running: __( 'Agent working...' ),
	done: __( 'Done' ),
};

function getNextAgentStatusForDescription(
	description: string,
	lastSyncedDescription: string,
	currentStatus: ScratchpadAgentStatus
): ScratchpadAgentStatus {
	const isDirty = description.trim() !== lastSyncedDescription.trim();
	if ( isDirty ) {
		return 'pending';
	}
	if ( currentStatus === 'done' ) {
		return 'done';
	}
	return 'idle';
}

function buildScratchpadAgentPrompt( widgetId: string, widgetProps: ScratchpadWidgetProps ) {
	const request =
		widgetProps.description?.trim() || __( 'Revise this scratchpad into a stronger version.' );
	const context = {
		widgetId,
		type: SCRATCHPAD_WIDGET_TYPE,
		widgetProps: {
			html: widgetProps.html,
			title: widgetProps.title,
			scope: widgetProps.scope,
			description: widgetProps.description,
			reference: widgetProps.reference,
		},
	};

	return [
		'Use this Studio scratchpad as context.',
		'Revise or rebuild it according to the user request in its description.',
		'When you have a result worth showing, call studio_present with exactly one scratchpad widget that includes updated html, title, scope, and description.',
		'',
		JSON.stringify( context, null, 2 ),
		'',
		'User request:',
		request,
	].join( '\n' );
}

function buildScratchpadAgentDisplayMessage( widgetProps: ScratchpadWidgetProps ) {
	const title = widgetProps.title || __( 'Untitled scratchpad' );
	const request = widgetProps.description?.trim();
	const heading = sprintf(
		/* translators: %s: scratchpad title. */
		__( 'Run agent on scratchpad: %s' ),
		title
	);

	return request ? `${ heading }\n\n${ request }` : heading;
}
