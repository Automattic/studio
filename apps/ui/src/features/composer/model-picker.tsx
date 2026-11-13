import { getStudioCodeAiAccessState } from '@studio/common/lib/studio-assistant-quota';
import {
	findAiModel,
	getAiModels,
	getProvider,
	PROVIDER_IDS,
	type ProviderId,
} from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useRef, useState, type ComponentType, type RefObject } from 'react';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { ProviderLogo } from '@/features/account';
import { getCreditsLabel, getModelDescription } from '@/features/composer/model-options';
import { PlugIcon, PlusIcon, ChevronDownIcon, ExternalLinkIcon } from '@/lib/icons';
import { Button, CommandSheet, Popover, type Command, type CommandGroup } from '@/lib/ui';
import type { AiModelId } from '@/data/core';

const PROVIDER_ICONS = Object.fromEntries(
	PROVIDER_IDS.map( ( id ) => [
		id,
		( { className }: { className?: string } ) => (
			<ProviderLogo provider={ id } className={ className } />
		),
	] )
) as Record< ProviderId, ComponentType< { className?: string } > >;

interface ModelPickerProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	model: AiModelId;
	// The providers this chat can use, and the one it is on.
	providers: ProviderId[];
	sessionProvider: ProviderId;
	isModelLocked: ( id: AiModelId ) => boolean;
	disabled: boolean;
	anchor: HTMLElement | null;
	onChange: ( provider: ProviderId, model: AiModelId ) => void;
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
	const connector = useConnector();
	const {
		data: quota,
		isError: isQuotaError,
		refetch: refetchQuota,
	} = useStudioAssistantQuota( { refetchOnWindowFocus: 'always' } );
	const { data: preferences } = useUserPreferences();
	const { data: aiSettings } = useAiSettings();
	const isWpcom = sessionProvider === 'wpcom';

	const modelLabel = findAiModel( model )?.model.label() ?? model;
	const credits = getCreditsLabel( isQuotaError ? null : quota, preferences?.locale );
	const canPurchaseCredits =
		isWpcom &&
		!! quota &&
		credits.hasCredits &&
		getStudioCodeAiAccessState( quota ) === 'available' &&
		quota.hasPaymentMethod;
	const account = aiSettings?.accounts[ sessionProvider ];
	const { note, links = [] } = account?.connected ? account : {};
	const modelDetails = [ modelLabel, getProvider( sessionProvider ).label ];
	if ( isWpcom ) {
		modelDetails.push( credits.label );
	}
	if ( note ) {
		modelDetails.push( note );
	}
	// A provider whose plan decides which models it runs offers only those.
	const modelsOf = ( provider: ProviderId ) => {
		const account = aiSettings?.accounts[ provider ];
		return getAiModels( provider, account?.connected ? account : undefined );
	};
	const pickCommand = ( value: string ) => {
		onOpenChange( false );
		if ( value === 'get-credits' ) {
			onAddCredits( triggerRef );
		} else if ( value === 'connect-provider' ) {
			openSettings( 'ai' );
		} else if ( value.startsWith( 'link:' ) ) {
			void connector.openExternalUrl( value.slice( 'link:'.length ) );
		} else {
			const provider = providers.find( ( id ) =>
				modelsOf( id ).some( ( item ) => item.id === value )
			);
			if ( provider ) {
				onChange( provider, value as AiModelId );
			}
		}
	};
	const groups: CommandGroup[] = [
		{
			label: __( 'Models' ),
			items: providers.flatMap( ( provider ) =>
				modelsOf( provider ).map( ( { id } ): Command => {
					const { label } = getProvider( provider );
					const strengths = getModelDescription( id );
					const description = strengths
						? sprintf(
								/* translators: 1: the model's provider, 2: what the model is good at. */
								__( '%1$s · %2$s' ),
								label,
								strengths
						  )
						: label;
					return {
						value: id,
						label: findAiModel( id )?.model.label() ?? id,
						description: isModelLocked( id )
							? `${ description } · ${ __( 'Purchased credits required' ) }`
							: description,
						icon: PROVIDER_ICONS[ provider ],
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
				...links.map( ( link ) => ( {
					value: `link:${ link.url }`,
					label: link.label,
					description: note,
					icon: ExternalLinkIcon,
				} ) ),
				{
					value: 'connect-provider',
					label: __( 'Connect providers' ),
					description: __( 'Use WordPress.com AI credits or your own API key.' ),
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
					setHighlight( model );
					if ( isWpcom ) {
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
