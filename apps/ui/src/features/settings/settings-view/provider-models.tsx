import {
	Button,
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxGroup,
	ComboboxGroupLabel,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
} from '@studio/ds';
import {
	getAiModels,
	getProvider,
	type AiModelId,
	type CatalogModel,
	type ProviderId,
} from '@studio/providers';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useMemo, useRef, useState } from 'react';
import { useProviderCatalog, useSelectProviderModels } from '@/data/queries/use-ai-settings';
import { SettingsRow } from './rows';
import type { ProviderAccount } from '@studio/common/lib/ai-settings';

const NAMED = 3;

// Which of a connected provider's models chat offers, checked in a list of its catalog. Each
// change saves right away and shows before it lands.
export function ProviderModels( {
	provider,
	account,
}: {
	provider: ProviderId;
	account: ProviderAccount & { connected: true };
} ) {
	const catalog = useProviderCatalog( provider );
	const select = useSelectProviderModels( provider );
	const [ picking, setPicking ] = useState< AiModelId[] >();
	const triggerRef = useRef< HTMLButtonElement >( null );
	const offered = getAiModels( provider, account );
	const ids = picking ?? offered.map( ( { id } ) => id );
	const recommended = catalog.data?.filter( ( model ) => model.recommended ) ?? [];

	const pick = ( models: CatalogModel[] ) => {
		const next = models.map( ( { id } ) => id );
		if ( ! next.length ) {
			return;
		}
		setPicking( next );
		select.mutate( models, {
			onSettled: () => setPicking( ( current ) => ( current === next ? undefined : current ) ),
		} );
	};

	const groups = useMemo( () => {
		const models = catalog.data ?? [];
		return [
			{ value: __( 'Recommended' ), items: models.filter( ( model ) => model.recommended ) },
			{ value: __( 'All models' ), items: models.filter( ( model ) => ! model.recommended ) },
		].filter( ( group ) => group.items.length );
	}, [ catalog.data ] );

	const labelOf = ( id: AiModelId ) =>
		catalog.data?.find( ( model ) => model.id === id )?.label ??
		offered.find( ( model ) => model.id === id )?.label() ??
		id;
	const names = ids.slice( 0, NAMED ).map( labelOf ).join( ', ' );
	const others = ids.length - NAMED;

	return (
		<SettingsRow
			title={ __( 'Models' ) }
			settingId={ `${ provider }-models` }
			description={
				others > 0
					? sprintf(
							/* translators: 1: model names, 2: how many more models */
							_n( '%1$s and %2$d other', '%1$s and %2$d others', others ),
							names,
							others
					  )
					: names
			}
			error={ ( catalog.error ?? select.error )?.message }
		>
			<Combobox
				items={ groups }
				multiple
				value={ catalog.data?.filter( ( model ) => ids.includes( model.id ) ) ?? [] }
				onValueChange={ pick }
				isItemEqualToValue={ ( item: CatalogModel, value: CatalogModel ) => item.id === value.id }
				itemToStringLabel={ ( item: CatalogModel ) => item.label }
			>
				<ComboboxTrigger
					ref={ triggerRef }
					aria-label={ sprintf(
						/* translators: %s: a service name such as OpenRouter */
						__( '%s models' ),
						getProvider( provider ).label
					) }
				>
					{ sprintf(
						/* translators: %d: number of models */
						_n( '%d model', '%d models', ids.length ),
						ids.length
					) }
				</ComboboxTrigger>
				<ComboboxContent
					anchor={ triggerRef }
					searchLabel={ __( 'Search models' ) }
					empty={ catalog.isLoading ? __( 'Loading models…' ) : __( 'No models found.' ) }
					footer={
						recommended.length > 0 && ids.join() !== recommended.map( ( { id } ) => id ).join() ? (
							<Button variant="ghost" size="sm" onClick={ () => pick( recommended ) }>
								{ __( 'Reset to recommended' ) }
							</Button>
						) : null
					}
				>
					<ComboboxList>
						{ ( group: ( typeof groups )[ number ] ) => (
							<ComboboxGroup key={ group.value } items={ group.items }>
								<ComboboxGroupLabel>{ group.value }</ComboboxGroupLabel>
								<ComboboxCollection>
									{ ( model: CatalogModel ) => (
										<ComboboxItem
											key={ model.id }
											value={ model }
											description={
												model.supportsImages
													? model.details
													: [ model.details, __( 'Can’t see screenshots' ) ]
															.filter( Boolean )
															.join( ' · ' )
											}
										>
											{ model.label }
										</ComboboxItem>
									) }
								</ComboboxCollection>
							</ComboboxGroup>
						) }
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
		</SettingsRow>
	);
}
