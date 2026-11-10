import {
	getEffortLabel,
	getModelEffortLevels,
	normalizeModelEffort,
	resolveModelEffort,
	type AiEffort,
} from '@studio/agent/protocol/model-effort';
import { getAiModelLabel, type AiModelId } from '@studio/agent/protocol/models';
import {
	AI_PROVIDER_LABELS,
	getAiProviderModels,
	type AiProviderId,
} from '@studio/agent/protocol/providers';
import {
	getModelFavoriteKey,
	type ModelFavorite,
} from '@studio/common/lib/user-settings/model-favorites';
import { __, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { clsx } from 'clsx';
import { CheckIcon } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { getCreditsLabel, getModelDescription } from '@/features/composer/model-options';
import { useModelFavorites } from '@/features/composer/use-model-favorites';
import { ChevronDownIcon, ClaudeIcon, DragHandleIcon, StarIcon, WordPressIcon } from '@/lib/icons';
import { isDialogOpen, isShortcut, isTextEntry } from '@/lib/keyboard';
import {
	Button,
	IconButton,
	Input,
	Menu,
	Popover,
	ReorderableList,
	type ReorderableItemProps,
} from '@/lib/ui';
import styles from './model-picker.module.css';

type AvailableFavorite = ModelFavorite & { model: AiModelId; provider: AiProviderId };
type ModelRowKind = 'reorderable' | 'catalog' | 'preview';
const DEFAULT_MODEL_COUNT = 3;

interface ModelPickerProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	model: AiModelId;
	effort: AiEffort;
	providers: AiProviderId[];
	sessionProvider: AiProviderId;
	isModelLocked: ( id: AiModelId ) => boolean;
	disabled: boolean;
	onChange: ( provider: AiProviderId, model: AiModelId, effort?: AiEffort ) => void;
}

export function ModelPicker( {
	open,
	onOpenChange,
	model,
	effort,
	providers,
	sessionProvider,
	isModelLocked,
	disabled,
	onChange,
}: ModelPickerProps ) {
	const [ search, setSearch ] = useState( '' );
	const [ reordering, setReordering ] = useState( false );
	const triggerRef = useRef< HTMLButtonElement | null >( null );
	const choices = useRef( new Map< string, HTMLElement >() );
	const resultsId = useId();
	const searchRef = useRef< HTMLInputElement | null >( null );
	const {
		data: quota,
		isError: isQuotaError,
		refetch: refetchQuota,
	} = useStudioAssistantQuota( { refetchOnWindowFocus: 'always' } );
	const { data: preferences } = useUserPreferences();
	const { favorites, update } = useModelFavorites();
	const available = ( favorite: ModelFavorite ): favorite is AvailableFavorite =>
		providers.includes( favorite.provider as AiProviderId ) &&
		getAiProviderModels( favorite.provider as AiProviderId ).some(
			( item ) => item.id === favorite.model
		) &&
		normalizeModelEffort( favorite.model as AiModelId, favorite.effort ) === favorite.effort;
	const visibleFavorites = favorites.filter( available );
	const shortcutFavorites = visibleFavorites.slice( 0, 9 );
	const shortcutFor = ( item: AvailableFavorite ) => {
		const index = shortcutFavorites.findIndex(
			( favorite ) => getModelFavoriteKey( favorite ) === getModelFavoriteKey( item )
		);
		return index >= 0 && ! isModelLocked( item.model ) ? String( index + 1 ) : undefined;
	};
	const saveOrder = ( ids: string[], models: AvailableFavorite[] ) =>
		update( [
			...ids.flatMap( ( id ) => models.filter( ( item ) => getModelFavoriteKey( item ) === id ) ),
			...favorites.filter( ( item ) => ! available( item ) ),
		] );
	const current: AvailableFavorite = { provider: sessionProvider, model, effort };
	const key = getModelFavoriteKey( current );
	const effortLevels = getModelEffortLevels( model );
	const resolvedEffort = resolveModelEffort( model, effort );
	const effortLabel = effortLevels.length ? getEffortLabel( resolvedEffort ) : __( 'Unavailable' );
	const query = search.trim().toLocaleLowerCase();
	const hasFavorite = ( favorite: ModelFavorite ) =>
		favorites.some( ( item ) => getModelFavoriteKey( item ) === getModelFavoriteKey( favorite ) );
	const toggleFavorite = ( favorite: ModelFavorite ) =>
		update(
			hasFavorite( favorite )
				? favorites.filter(
						( item ) => getModelFavoriteKey( item ) !== getModelFavoriteKey( favorite )
				  )
				: [ favorite, ...favorites ]
		);
	const isWpcom = sessionProvider === 'wpcom';
	const modelLabel = getAiModelLabel( model );
	const credits = getCreditsLabel( isQuotaError ? null : quota, preferences?.locale );
	const modelDetails = [
		modelLabel,
		AI_PROVIDER_LABELS[ sessionProvider ],
		...( effortLevels.length ? [ getEffortLabel( resolvedEffort ) ] : [] ),
		...( isWpcom ? [ credits.label ] : [] ),
	];
	const presetLabel = ( item: AvailableFavorite ) =>
		[
			getAiModelLabel( item.model ),
			item.effort !== 'default' ? getEffortLabel( item.effort ) : '',
		]
			.filter( Boolean )
			.join( ' · ' );
	const select = ( item: AvailableFavorite ) => {
		if ( reordering ) return;
		onChange( item.provider, item.model, item.effort );
	};
	const onModelShortcut = useEffectEvent( ( event: KeyboardEvent ) => {
		const trigger = triggerRef.current;
		if (
			disabled ||
			reordering ||
			event.defaultPrevented ||
			event.repeat ||
			! trigger ||
			trigger.closest( '[inert], [hidden], [aria-hidden="true"]' ) ||
			isDialogOpen()
		)
			return;
		const item = shortcutFavorites.find( ( _, index ) =>
			isShortcut( event, String( index + 1 ), 'alt' )
		);
		if ( ! item || isModelLocked( item.model ) ) return;
		const target = event.target instanceof Element ? event.target : null;
		const popup = target?.closest( '[role="dialog"], [role="menu"]' );
		if ( popup && ! popup.contains( searchRef.current ) ) return;
		if (
			isTextEntry( target ) &&
			target !== searchRef.current &&
			! trigger.closest( '[data-slot="input-group"]' )?.contains( target )
		)
			return;
		event.preventDefault();
		select( item );
	} );
	useEffect( () => {
		document.addEventListener( 'keydown', onModelShortcut );
		return () => document.removeEventListener( 'keydown', onModelShortcut );
	}, [] );
	const matches = ( item: AvailableFavorite ) => {
		const text = `${ getAiModelLabel( item.model ) } ${ item.model } ${
			AI_PROVIDER_LABELS[ item.provider ]
		} ${
			getModelEffortLevels( item.model ).length
				? getEffortLabel( resolveModelEffort( item.model, item.effort ) )
				: ''
		}`.toLocaleLowerCase();
		return query.split( /\s+/ ).every( ( word ) => text.includes( word ) );
	};
	const favoriteResults = visibleFavorites.filter( matches );
	const catalogResults = providers
		.flatMap( ( provider ) =>
			getAiProviderModels( provider ).map( ( item ) => ( {
				provider,
				model: item.id,
				effort: normalizeModelEffort( item.id, effort ),
			} ) )
		)
		.filter( ( item ) => ! hasFavorite( item ) && matches( item ) );
	const starterCount = Math.max( 0, DEFAULT_MODEL_COUNT - visibleFavorites.length );
	const starterResults = catalogResults.slice( 0, starterCount );
	const currentResult = catalogResults.find( ( item ) => getModelFavoriteKey( item ) === key );
	if (
		starterCount &&
		currentResult &&
		! starterResults.some( ( item ) => getModelFavoriteKey( item ) === key )
	) {
		starterResults.splice( starterCount - 1, 1, currentResult );
	}
	const otherResults = query ? catalogResults : starterResults;
	const unsavedCurrent =
		! query &&
		currentResult &&
		! otherResults.some( ( item ) => getModelFavoriteKey( item ) === key )
			? currentResult
			: null;
	const results = [
		...favoriteResults,
		...otherResults,
		...( unsavedCurrent ? [ unsavedCurrent ] : [] ),
	];
	const showingStarters = ! query && otherResults.length > 0;
	const reorderableResults = query ? favoriteResults : results;
	const reorder = ( ids: string[], movedId: string ) => {
		const keepCurrentUnsaved = !! unsavedCurrent && movedId !== key;
		const savedIds = keepCurrentUnsaved ? ids.filter( ( id ) => id !== key ) : ids;
		saveOrder( savedIds, reorderableResults );
		return keepCurrentUnsaved ? [ ...savedIds, key ] : ids;
	};
	const selectable = results.filter( ( item ) => ! isModelLocked( item.model ) );
	const focusResult = ( index: number ) => {
		const item = selectable[ ( index + selectable.length ) % selectable.length ];
		if ( item ) choices.current.get( getModelFavoriteKey( item ) )?.focus();
	};
	useEffect( () => {
		if ( open ) {
			setSearch( '' );
			if ( isWpcom ) void refetchQuota();
		}
	}, [ open, isWpcom, refetchQuota ] );
	const modelRow = (
		item: AvailableFavorite,
		kind: ModelRowKind,
		itemProps?: ReorderableItemProps
	) => {
		const favorite = hasFavorite( item );
		const itemKey = getModelFavoriteKey( item );
		const selected = itemKey === key;
		const label = presetLabel( item );
		const shortcut = shortcutFor( item );
		const Icon = item.provider === 'wpcom' ? WordPressIcon : ClaudeIcon;
		const Row = kind === 'catalog' ? 'div' : 'li';
		return (
			<Row
				key={ itemKey }
				{ ...itemProps }
				className={ clsx( styles.row, itemProps?.className ) }
				data-current={ selected || undefined }
			>
				{ ( kind === 'reorderable' && ! query ) || kind === 'preview' ? (
					<IconButton
						variant="muted-ghost"
						size="icon-2xs"
						className={ styles.grip }
						icon={ <DragHandleIcon /> }
						tooltip={ false }
						label={ sprintf( __( 'Reorder %s' ), label ) }
						aria-description={ __( 'Drag to reorder, or use the Up and Down arrow keys.' ) }
						data-model-reorder-handle
					/>
				) : null }
				<Menu.ItemButton
					className={ styles.choice }
					ref={ ( node ) => {
						if ( kind === 'preview' ) return;
						if ( node ) choices.current.set( itemKey, node );
						else choices.current.delete( itemKey );
					} }
					aria-pressed={ selected }
					aria-label={ label }
					aria-keyshortcuts={ shortcut ? ariaKeyShortcut.primaryAlt( shortcut ) : undefined }
					aria-description={
						isModelLocked( item.model )
							? __( 'Purchased credits required' )
							: getModelDescription( item.model )
					}
					disabled={ isModelLocked( item.model ) }
					onClick={ () => select( item ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {
							event.preventDefault();
							const index = selectable.findIndex(
								( option ) => getModelFavoriteKey( option ) === itemKey
							);
							if ( index === 0 && event.key === 'ArrowUp' ) searchRef.current?.focus();
							else focusResult( index + ( event.key === 'ArrowDown' ? 1 : -1 ) );
						}
					} }
				>
					<Icon className={ styles.providerIcon } />
					<Menu.ItemLabel className={ styles.label }>
						{ getAiModelLabel( item.model ) }
						{ item.effort !== 'default' ? (
							<span className={ styles.presetEffort }>{ getEffortLabel( item.effort ) }</span>
						) : null }
					</Menu.ItemLabel>
					<span className={ styles.trailing } data-icon="inline-end" aria-hidden="true">
						{ selected ? (
							<CheckIcon className={ styles.check } />
						) : shortcut ? (
							<Menu.Shortcut>{ displayShortcut.primaryAlt( shortcut ) }</Menu.Shortcut>
						) : null }
					</span>
				</Menu.ItemButton>
				<IconButton
					variant="muted-ghost"
					size="icon-2xs"
					className={ styles.star }
					disabled={ reordering }
					icon={ <StarIcon fill={ favorite ? 'currentColor' : 'none' } /> }
					label={ sprintf( favorite ? __( 'Unstar %s' ) : __( 'Star %s' ), label ) }
					aria-pressed={ favorite }
					onClick={ () => {
						searchRef.current?.focus();
						toggleFavorite( item );
					} }
				/>
			</Row>
		);
	};

	return (
		<Popover.Root open={ open } onOpenChange={ onOpenChange }>
			<Popover.Trigger
				render={
					<Button
						ref={ triggerRef }
						variant="ghost"
						shape="round"
						aria-label={ __( 'Model' ) }
						aria-description={ modelDetails.join( ' · ' ) }
						title={ modelDetails.join( ' · ' ) }
						disabled={ disabled }
					/>
				}
			>
				<span>
					{ modelLabel }
					{ effort !== 'default' ? ` · ${ getEffortLabel( effort ) }` : '' }
				</span>
				<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
			</Popover.Trigger>
			<Popover.Popup
				backdrop
				instant={ ! open }
				side="top"
				align="end"
				className={ styles.popup }
				aria-label={ __( 'Choose a model' ) }
				initialFocus={ searchRef }
				finalFocus={ triggerRef }
			>
				<Input
					variant="group"
					className={ styles.searchRow }
					ref={ searchRef }
					placeholder={ __( 'Search models…' ) }
					aria-label={ __( 'Search models' ) }
					aria-controls={ resultsId }
					value={ search }
					onChange={ ( event ) => setSearch( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.nativeEvent.isComposing ) return;
						if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {
							event.preventDefault();
							focusResult( event.key === 'ArrowDown' ? 0 : selectable.length - 1 );
						} else if ( event.key === 'Enter' && selectable.length ) {
							event.preventDefault();
							select( selectable[ 0 ] );
						}
					} }
				/>
				<div id={ resultsId } className={ styles.models }>
					{ reorderableResults.length ? (
						<div
							role="group"
							aria-label={
								showingStarters || unsavedCurrent
									? __( 'Available models' )
									: __( 'Favorite models' )
							}
						>
							<ReorderableList
								items={ reorderableResults }
								getItemId={ getModelFavoriteKey }
								getItemLabel={ presetLabel }
								renderItem={ ( item, props ) =>
									modelRow( item, props[ 'aria-hidden' ] ? 'preview' : 'reorderable', props )
								}
								onReorder={ reorder }
								className={ styles.favorites }
								previewClassName={ styles.dragPreview }
								handleSelector="[data-model-reorder-handle]"
								portalPreview
								disabled={ ! open || !! query }
								onReorderingChange={ ( active ) => {
									setReordering( active );
									if ( ! active ) searchRef.current?.focus( { preventScroll: true } );
								} }
							/>
						</div>
					) : null }
					{ otherResults.length && query ? (
						<div
							role="group"
							aria-label={
								visibleFavorites.length ? __( 'Other models' ) : __( 'Available models' )
							}
						>
							{ otherResults.map( ( item ) => modelRow( item, 'catalog' ) ) }
						</div>
					) : null }
					{ ! results.length ? (
						<p className={ styles.empty }>
							{ query ? __( 'No matching models.' ) : __( 'No models available.' ) }
						</p>
					) : null }
				</div>
				<div className={ styles.separator } />
				<Menu.Root>
					<Menu.Trigger
						aria-label={ sprintf( __( 'Effort: %s' ), effortLabel ) }
						disabled={ ! effortLevels.length || isModelLocked( model ) }
						render={ <Menu.ItemButton /> }
					>
						<span>{ __( 'Effort' ) }</span>
						<span className={ styles.effortValue } data-icon="inline-end">
							<span>{ effortLabel }</span>
							<Menu.SubmenuIndicator />
						</span>
					</Menu.Trigger>
					{ effortLevels.length ? (
						<Menu.SubmenuPopup aria-label={ __( 'Effort' ) } data-instant>
							<Menu.RadioGroup
								value={ resolvedEffort }
								onValueChange={ ( value ) => {
									const next = normalizeModelEffort(
										model,
										value === 'medium' ? 'default' : value
									);
									if ( value !== resolvedEffort ) onChange( sessionProvider, model, next );
								} }
							>
								{ effortLevels.map( ( level ) => (
									<Menu.RadioItem key={ level } value={ level }>
										{ getEffortLabel( level ) }
									</Menu.RadioItem>
								) ) }
							</Menu.RadioGroup>
						</Menu.SubmenuPopup>
					) : null }
				</Menu.Root>
			</Popover.Popup>
		</Popover.Root>
	);
}
