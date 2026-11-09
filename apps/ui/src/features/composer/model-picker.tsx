import { getAiModelLabel } from '@studio/agent/protocol/models';
import {
	getAiProvider,
	getAiProviderModels,
	type AiProviderId,
} from '@studio/agent/protocol/providers';
import { getStudioCodeAiAccessState } from '@studio/common/lib/studio-assistant-quota';
import { __, sprintf } from '@wordpress/i18n';
import { PlugIcon } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { getAiProviderUi } from '@/features/ai-providers';
import { getCreditsLabel, getModelDescription } from '@/features/composer/model-options';
import { PlusIcon, ChevronDownIcon } from '@/lib/icons';
import { Button, CommandSheet, Popover, type Command, type CommandGroup } from '@/lib/ui';
import type { AiModelId } from '@/data/core';

interface ModelPickerProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	model: AiModelId;
	// The providers this chat can use, and the one it is on.
	providers: AiProviderId[];
	sessionProvider: AiProviderId;
	isModelLocked: ( id: AiModelId ) => boolean;
	disabled: boolean;
	anchor: HTMLElement | null;
	onChange: ( provider: AiProviderId, model: AiModelId ) => void;
	onAddCredits: ( returnFocus: RefObject< HTMLElement | null > ) => void;
}

export function ModelPicker( {
	open,
	onOpenChange,
	model,
	providers,
	sessionProvider,
	isModelLocked,
	disabled,
	anchor,
	onChange,
	onAddCredits,
}: ModelPickerProps ) {
	const [ highlight, setHighlight ] = useState< string >();
	const listRef = useRef< HTMLDivElement | null >( null );
	const triggerRef = useRef< HTMLButtonElement | null >( null );
	const openSettings = useOpenSettings();
	const {
		data: quota,
		isError: isQuotaError,
		refetch: refetchQuota,
	} = useStudioAssistantQuota( { refetchOnWindowFocus: 'always' } );
	const { data: preferences } = useUserPreferences();
	const { usesStudioCredits } = getAiProvider( sessionProvider );

	const modelLabel = getAiModelLabel( model );
	const credits = getCreditsLabel( isQuotaError ? null : quota, preferences?.locale );
	const canPurchaseCredits =
		usesStudioCredits &&
		!! quota &&
		credits.hasCredits &&
		getStudioCodeAiAccessState( quota ) === 'available' &&
		quota.hasPaymentMethod;
	const modelDetails = [ modelLabel, getAiProvider( sessionProvider ).label ];
	if ( usesStudioCredits ) {
		modelDetails.push( credits.label );
	}
	const pickCommand = ( value: string ) => {
		onOpenChange( false );
		if ( value === 'get-credits' ) {
			onAddCredits( triggerRef );
		} else if ( value === 'connect-provider' ) {
			openSettings( 'ai' );
		} else {
			const provider = providers.find( ( id ) => value.startsWith( `${ id }/` ) );
			const pickedModel =
				provider &&
				getAiProviderModels( provider ).find( ( item ) => `${ provider }/${ item.id }` === value );
			if ( provider && pickedModel ) {
				onChange( provider, pickedModel.id );
			}
		}
	};
	const groups: CommandGroup[] = [
		{
			label: __( 'Models' ),
			items: providers.flatMap( ( provider ) =>
				getAiProviderModels( provider ).map( ( { id } ): Command => {
					const description = sprintf(
						/* translators: 1: the model's provider, 2: what the model is good at. */
						__( '%1$s · %2$s' ),
						getAiProvider( provider ).modelLabel,
						getModelDescription( id )
					);
					return {
						value: `${ provider }/${ id }`,
						label: getAiModelLabel( id ),
						description: isModelLocked( id )
							? `${ description } · ${ __( 'Purchased credits required' ) }`
							: description,
						icon: getAiProviderUi( provider ).icon,
						disabled: isModelLocked( id ),
					};
				} )
			),
		},
		{
			label: __( 'Actions' ),
			heading: __( 'Actions' ),
			items: [
				...( canPurchaseCredits
					? [
							{
								value: 'get-credits',
								label: __( 'Get more credits' ),
								description: credits.label,
								icon: PlusIcon,
							},
					  ]
					: [] ),
				{
					value: 'connect-provider',
					label: __( 'Connect provider…' ),
					description: __( 'Add or manage your providers' ),
					icon: PlugIcon,
				},
			],
		},
	];

	return (
		<Popover.Root
			open={ open }
			onOpenChange={ ( next ) => {
				onOpenChange( next );
				if ( next ) {
					setHighlight( `${ sessionProvider }/${ model }` );
					if ( usesStudioCredits ) {
						void refetchQuota();
					}
				}
			} }
		>
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
				<span>{ modelLabel }</span>
				<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
			</Popover.Trigger>
			<CommandSheet
				label={ __( 'Choose a model' ) }
				groups={ groups }
				highlighted={ highlight }
				onHighlight={ setHighlight }
				onSelect={ pickCommand }
				listRef={ listRef }
				anchor={ anchor }
				initialFocus={ listRef }
				finalFocus={ triggerRef }
			/>
		</Popover.Root>
	);
}
