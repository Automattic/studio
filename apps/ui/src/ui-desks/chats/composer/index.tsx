import { AI_MODELS, getAiModelFamily, getAiModelLabel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { arrowUp, chevronDownSmall, closeSmall, code } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { useChats } from '@/ui-desks/chats/context';
import {
	buildWidgetContextDisplayMessage,
	buildWidgetContextPrompt,
	getWidgetDisplayLabel,
	MAX_VISIBLE_CHAT_WIDGETS,
	WidgetContextMoreThumbnail,
	WidgetContextThumbnail,
} from '@/ui-desks/chats/widget-context';
import { Button, Menu } from '@/ui-desks/components';
import { EnvironmentPill } from './environment-pill';
import { FamilySwitchConfirmDialog } from './family-switch-confirm-dialog';
import styles from './style.module.css';
import type { AiModelId, LoadedAiSession, SessionEntry, SyncSite } from '@/data/core';
import type { DeskWidget } from '@/ui-desks/widgets/types';

export function ComposerSkeleton() {
	return (
		<div className={ styles.root } style={ { visibility: 'hidden' } } aria-hidden="true">
			<form className={ styles.prompt }>
				<textarea className={ styles.input } rows={ 1 } disabled tabIndex={ -1 } />
				<div className={ styles.promptBar }>
					<div className={ styles.promptTools }>
						<div className={ styles.leftTools }>
							<span className={ clsx( styles.skeletonTool, styles.iconTool ) } />
						</div>
						<div className={ styles.rightTools }>
							<span className={ clsx( styles.skeletonTool, styles.skeletonTextTool ) } />
						</div>
					</div>
					<span className={ clsx( styles.skeletonTool, styles.skeletonAction ) } />
				</div>
			</form>
		</div>
	);
}

interface ComposerProps {
	busy: boolean;
	isInterrupting?: boolean;
	error: string | null;
	model: AiModelId;
	onSend: ( prompt: string, options?: { displayMessage?: string } ) => Promise< void >;
	onInterrupt: () => Promise< void >;
	sessionId?: string;
	effectiveEnvironment?: 'local' | 'live';
	liveSite?: SyncSite;
	entries?: SessionEntry[];
	ownerSiteId?: string;
	onSwitchSession?: ( sessionId: string ) => void;
	autoFocus?: boolean;
	previewPrompt?: string | null;
	draftPrompt?: {
		id: number;
		prompt: string;
	} | null;
}

export function Composer( {
	busy,
	isInterrupting = false,
	error,
	model,
	onSend,
	onInterrupt,
	sessionId,
	effectiveEnvironment = 'local',
	liveSite,
	entries,
	ownerSiteId,
	onSwitchSession,
	autoFocus = false,
	previewPrompt,
	draftPrompt,
}: ComposerProps ) {
	const [ value, setValue ] = useState( '' );
	const [ contextWidgets, setContextWidgets ] = useState< DeskWidget[] >( [] );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const appliedDraftPromptIdRef = useRef< number | null >( null );
	const connector = useConnector();
	const queryClient = useQueryClient();
	const {
		composerWidgetAttachmentRequest,
		consumeComposerWidgetAttachmentRequest,
		isComposerWidgetDragTarget,
	} = useChats();
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< AiModelId | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

	useEffect( () => {
		if ( autoFocus ) {
			textareaRef.current?.focus();
		}
	}, [ autoFocus, sessionId ] );

	useEffect( () => {
		if ( ! draftPrompt || appliedDraftPromptIdRef.current === draftPrompt.id ) {
			return;
		}
		appliedDraftPromptIdRef.current = draftPrompt.id;
		setValue( draftPrompt.prompt );
		queueMicrotask( () => {
			const node = textareaRef.current;
			if ( ! node ) {
				return;
			}
			node.focus();
			const length = node.value.length;
			node.setSelectionRange( length, length );
		} );
	}, [ draftPrompt ] );

	const send = useCallback( async () => {
		const trimmed = value.trim();
		if ( ! trimmed ) {
			return;
		}
		const widgetsToSend = contextWidgets;
		setValue( '' );
		setContextWidgets( [] );
		try {
			if ( widgetsToSend.length > 0 ) {
				await onSend( buildWidgetContextPrompt( trimmed, widgetsToSend ), {
					displayMessage: buildWidgetContextDisplayMessage( trimmed, widgetsToSend ),
				} );
				return;
			}

			await onSend( trimmed );
		} catch {
			setValue( trimmed );
			setContextWidgets( widgetsToSend );
		}
	}, [ contextWidgets, onSend, value ] );

	useEffect( () => {
		if (
			! composerWidgetAttachmentRequest ||
			composerWidgetAttachmentRequest.sessionId !== sessionId
		) {
			return;
		}

		setContextWidgets( ( currentWidgets ) =>
			mergeWidgetAttachments( currentWidgets, composerWidgetAttachmentRequest.widgets )
		);
		consumeComposerWidgetAttachmentRequest( composerWidgetAttachmentRequest.id );
		textareaRef.current?.focus();
	}, [ composerWidgetAttachmentRequest, consumeComposerWidgetAttachmentRequest, sessionId ] );

	const removeContextWidget = useCallback( ( widgetId: string ) => {
		setContextWidgets( ( currentWidgets ) =>
			currentWidgets.filter( ( widget ) => widget.id !== widgetId )
		);
	}, [] );

	const applySameFamilyModel = useCallback(
		( picked: AiModelId ) => {
			if ( ! sessionId ) {
				return;
			}
			const timestamp = new Date().toISOString();
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, sessionId ],
				( prev ) =>
					prev
						? {
								...prev,
								entries: [
									...( prev.entries ?? [] ),
									{
										type: 'model_change',
										id: Math.random().toString( 36 ).slice( 2, 10 ),
										parentId: null,
										timestamp,
										provider: '',
										modelId: picked,
									} as unknown as SessionEntry,
								],
						  }
						: prev
			);
			void connector.setSessionModel( sessionId, picked ).catch( () => {
				void queryClient.invalidateQueries( {
					queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
				} );
			} );
		},
		[ connector, queryClient, sessionId ]
	);

	const handleModelChange = useCallback(
		( picked: AiModelId ) => {
			if ( picked === model ) {
				return;
			}
			const hasTurns = ( entries ?? [] ).some( ( entry ) =>
				isStudioCustomEntryOfType( entry, 'studio.user_prompt' )
			);
			if (
				getAiModelFamily( model ) !== getAiModelFamily( picked ) &&
				onSwitchSession &&
				hasTurns
			) {
				setPendingFamilyChange( picked );
				return;
			}
			applySameFamilyModel( picked );
		},
		[ applySameFamilyModel, entries, model, onSwitchSession ]
	);

	const cancelFamilyChange = useCallback( () => {
		if ( familySwitchInFlight ) {
			return;
		}
		setPendingFamilyChange( null );
	}, [ familySwitchInFlight ] );

	const confirmFamilyChange = useCallback( async () => {
		if ( ! pendingFamilyChange || ! onSwitchSession ) {
			return;
		}
		setFamilySwitchInFlight( true );
		try {
			const newSession = await connector.createSession( ownerSiteId );
			await connector
				.setSessionModel( newSession.id, pendingFamilyChange )
				.catch( () => undefined );
			await queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			setPendingFamilyChange( null );
			onSwitchSession( newSession.id );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [ connector, onSwitchSession, ownerSiteId, pendingFamilyChange, queryClient ] );

	const canSend = value.trim().length > 0;
	const showSendButton = ! busy || canSend;
	const sendAriaLabel = busy ? __( 'Queue' ) : __( 'Send' );
	const visibleContextWidgets = contextWidgets.slice( 0, MAX_VISIBLE_CHAT_WIDGETS );
	const hiddenContextWidgetCount = contextWidgets.length - visibleContextWidgets.length;

	return (
		<>
			<div
				className={ styles.root }
				data-active={ canSend || contextWidgets.length > 0 ? 'true' : 'false' }
			>
				{ contextWidgets.length > 0 && (
					<div className={ styles.attachments } aria-label={ __( 'Attached canvas widgets' ) }>
						{ visibleContextWidgets.map( ( widget ) => (
							<div
								key={ widget.id }
								className={ styles.attachment }
								aria-label={ getWidgetDisplayLabel( widget ) }
								title={ getWidgetDisplayLabel( widget ) }
							>
								<WidgetContextThumbnail widget={ widget } />
								<Button
									variant="filled"
									size="xsmall"
									className={ styles.removeAttachment }
									icon={ closeSmall }
									label={ getRemoveWidgetAttachmentLabel( widget ) }
									tooltipLabel={ false }
									title={ getRemoveWidgetAttachmentLabel( widget ) }
									onClick={ () => removeContextWidget( widget.id ) }
								/>
							</div>
						) ) }
						{ hiddenContextWidgetCount > 0 && (
							<WidgetContextMoreThumbnail count={ hiddenContextWidgetCount } />
						) }
					</div>
				) }
				<form
					className={ styles.prompt }
					data-ui-desks-composer-dropzone
					data-widget-drag-over={ isComposerWidgetDragTarget ? 'true' : 'false' }
					onSubmit={ ( event ) => {
						event.preventDefault();
						void send();
					} }
				>
					<textarea
						ref={ textareaRef }
						className={ styles.input }
						placeholder={ __( 'Ask Studio Desk…' ) }
						value={ previewPrompt ?? value }
						data-preview={ previewPrompt ? 'true' : 'false' }
						onChange={ ( event ) => setValue( event.target.value ) }
						onKeyDown={ ( event ) => {
							if ( event.key === 'Escape' && busy ) {
								event.preventDefault();
								void onInterrupt();
								return;
							}
							if ( event.key === 'Enter' && ! event.shiftKey ) {
								event.preventDefault();
								void send();
							}
						} }
						rows={ 1 }
					/>
					<div className={ styles.promptBar }>
						<div className={ styles.promptTools }>
							<div className={ styles.leftTools }>
								<Menu.Root modal={ false }>
									<Menu.Trigger
										render={
											<Button
												variant="quiet"
												size="small"
												className={ styles.iconTool }
												label={ __( 'Commands' ) }
												tooltipLabel={ false }
												aria-label={ __( 'Commands' ) }
												title={ __( 'Commands' ) }
											>
												<Icon icon={ code } size={ 20 } />
											</Button>
										}
									/>
									<Menu.Popup side="top" align="start" className={ styles.commandsMenuPopup }>
										{ AI_SKILL_COMMANDS.map( ( command ) => (
											<Menu.Item
												key={ command.name }
												className={ styles.commandMenuItem }
												onClick={ () => {
													void onSend( `/${ command.name }` );
												} }
											>
												<span className={ styles.commandItem }>
													<span className={ styles.commandName }>/{ command.name }</span>
													<span className={ styles.commandDescription }>
														{ command.description }
													</span>
												</span>
											</Menu.Item>
										) ) }
									</Menu.Popup>
								</Menu.Root>
							</div>
							<div className={ styles.rightTools }>
								{ sessionId && liveSite ? (
									<EnvironmentPill
										sessionId={ sessionId }
										effectiveEnvironment={ effectiveEnvironment }
										liveSite={ liveSite }
										disabled={ busy }
									/>
								) : null }
								<Menu.Root modal={ false }>
									<Menu.Trigger
										render={
											<Button
												variant="quiet"
												size="small"
												className={ styles.modelTool }
												label={ __( 'Select model' ) }
												tooltipLabel={ false }
												aria-label={ __( 'Select model' ) }
												title={ __( 'Select model' ) }
											>
												<span>{ getAiModelLabel( model ) }</span>
												<Icon icon={ chevronDownSmall } size={ 14 } />
											</Button>
										}
									/>
									<Menu.Popup side="top" align="end" width="content">
										<Menu.RadioGroup
											value={ model }
											onValueChange={ ( value ) => handleModelChange( value as AiModelId ) }
										>
											{ AI_MODELS.map( ( { id, label } ) => (
												<Menu.RadioItem key={ id } value={ id }>
													{ label }
												</Menu.RadioItem>
											) ) }
										</Menu.RadioGroup>
									</Menu.Popup>
								</Menu.Root>
							</div>
						</div>
						<div className={ styles.promptActions }>
							{ busy ? (
								<Button
									tone="inverse"
									variant="filled"
									size="small"
									className={ styles.stopButton }
									label={ isInterrupting ? __( 'Stopping' ) : __( 'Stop' ) }
									tooltipLabel={ false }
									onClick={ () => void onInterrupt() }
									aria-busy={ isInterrupting }
									title={
										isInterrupting ? __( 'Stopping… click again to force stop' ) : __( 'Stop' )
									}
								>
									<span className={ styles.stopGlyph } aria-hidden="true" />
								</Button>
							) : null }
							{ showSendButton ? (
								<Button
									type="submit"
									tone="primary"
									variant="filled"
									size="small"
									disabled={ ! canSend }
									icon={ arrowUp }
									label={ sendAriaLabel }
									tooltipLabel={ false }
								/>
							) : null }
						</div>
					</div>
				</form>
				{ error ? <div className={ styles.error }>{ error }</div> : null }
			</div>
			<FamilySwitchConfirmDialog
				currentModel={ model }
				pendingModel={ pendingFamilyChange }
				inFlight={ familySwitchInFlight }
				onCancel={ cancelFamilyChange }
				onConfirm={ () => void confirmFamilyChange() }
			/>
		</>
	);
}

function mergeWidgetAttachments( currentWidgets: DeskWidget[], incomingWidgets: DeskWidget[] ) {
	const widgetsById = new Map( currentWidgets.map( ( widget ) => [ widget.id, widget ] ) );
	for ( const widget of incomingWidgets ) {
		widgetsById.set( widget.id, widget );
	}
	return Array.from( widgetsById.values() );
}

function getRemoveWidgetAttachmentLabel( widget: DeskWidget ) {
	return `${ __( 'Remove' ) } ${ getWidgetDisplayLabel( widget ) }`;
}
