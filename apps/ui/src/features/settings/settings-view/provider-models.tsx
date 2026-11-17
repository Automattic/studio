import { getAiModels, getProvider, type CatalogModel, type ProviderId } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useMemo, useRef, useState } from 'react';
import { useProviderCatalog, useSelectProviderModels } from '@/data/queries/use-ai-settings';
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxCollection,
	ComboboxContent,
	ComboboxGroup,
	ComboboxGroupLabel,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxValue,
} from '@/lib/ui';
import { SettingsRow } from './rows';
import styles from './style.module.css';
import type { ProviderAccount } from '@studio/common/lib/ai-settings';

type Option = Pick< CatalogModel, 'id' | 'label' > & Partial< CatalogModel >;

// Which of a connected provider's models chat offers, picked from its catalog. Picks save when the
// list closes, or right away when a chip is removed.
export function ProviderModels( {
	provider,
	account,
}: {
	provider: ProviderId;
	account: ProviderAccount & { connected: true };
} ) {
	const catalog = useProviderCatalog( provider );
	const select = useSelectProviderModels( provider );
	const chipsRef = useRef< HTMLDivElement >( null );
	const [ open, setOpen ] = useState( false );
	const offered = useMemo(
		(): Option[] =>
			getAiModels( provider, account ).map( ( model ) => {
				const listed = catalog.data?.find( ( { id } ) => id === model.id );
				return listed ?? { id: model.id, label: model.label() };
			} ),
		[ provider, account, catalog.data ]
	);
	const [ draft, setDraft ] = useState< Option[] >();
	const value = draft ?? offered;

	const save = ( picked: Option[] ) => {
		setDraft( undefined );
		const ids = picked.map( ( { id } ) => id );
		if ( ids.length && ids.join() !== offered.map( ( { id } ) => id ).join() ) {
			select.mutate( ids );
		}
	};

	const groups = useMemo( () => {
		const models = catalog.data ?? [];
		return [
			{ value: __( 'Recommended' ), items: models.filter( ( model ) => model.recommended ) },
			{ value: __( 'All models' ), items: models.filter( ( model ) => ! model.recommended ) },
		].filter( ( group ) => group.items.length );
	}, [ catalog.data ] );

	return (
		<SettingsRow
			title={ __( 'Models' ) }
			settingId={ `${ provider }-models` }
			description={ sprintf(
				/* translators: %s: a service name such as OpenRouter */
				__( 'The %s models to offer in chat.' ),
				getProvider( provider ).label
			) }
			error={ ( catalog.error ?? select.error )?.message }
			stacked
		>
			<Combobox
				items={ groups }
				multiple
				value={ value }
				open={ open }
				onOpenChange={ ( next ) => {
					setOpen( next );
					if ( ! next && draft ) {
						save( draft );
					}
				} }
				onValueChange={ ( next: Option[] ) => {
					if ( ! next.length ) {
						return;
					}
					if ( open ) {
						setDraft( next );
					} else {
						save( next );
					}
				} }
				isItemEqualToValue={ ( item: Option, picked: Option ) => item.id === picked.id }
				itemToStringLabel={ ( item: Option ) => item.label }
				disabled={ select.isPending }
			>
				<ComboboxChips ref={ chipsRef } className={ styles.modelChips }>
					<ComboboxValue>
						{ ( picked: Option[] ) =>
							picked.map( ( model ) => (
								<ComboboxChip
									key={ model.id }
									removeLabel={ sprintf(
										/* translators: %s: a model name */
										__( 'Remove %s' ),
										model.label
									) }
								>
									{ model.label }
								</ComboboxChip>
							) )
						}
					</ComboboxValue>
					<ComboboxInput
						aria-label={ __( 'Search models' ) }
						placeholder={ catalog.isLoading ? __( 'Loading models…' ) : __( 'Add a model' ) }
					/>
				</ComboboxChips>
				<ComboboxContent anchor={ chipsRef } empty={ __( 'No models found.' ) }>
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
