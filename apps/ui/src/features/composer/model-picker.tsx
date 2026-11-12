import { getStudioCodeAiAccessState } from '@studio/common/lib/studio-assistant-quota';
import {
	getAiModelLabel,
	getAiModels,
	getProviderDescriptor,
	type ProviderId,
} from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { PlugIcon } from 'lucide-react';
import { useRef, useState, type ComponentType, type RefObject } from 'react';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { getCreditsLabel, getModelDescription } from '@/features/composer/model-options';
import { PlusIcon, ChevronDownIcon, IntelligenceIcon } from '@/lib/icons';
import { Button, CommandSheet, Popover, type Command, type CommandGroup } from '@/lib/ui';
import type { AiModelId } from '@/data/core';

type Icon = ComponentType< { className?: string } >;
const providerIcons = new Map< ProviderId, Icon >();

// The provider's mark, or a generic one for a provider without.
function getProviderIcon( provider: ProviderId ): Icon {
	let icon = providerIcons.get( provider );
	if ( ! icon ) {
		const path = getProviderDescriptor( provider ).icon;
		icon = path
			? ( { className } ) => (
					<svg
						className={ className }
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path d={ path } />
					</svg>
			  )
			: IntelligenceIcon;
		providerIcons.set( provider, icon );
	}
	return icon;
}

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
	const {
		data: quota,
		isError: isQuotaError,
		refetch: refetchQuota,
	} = useStudioAssistantQuota( { refetchOnWindowFocus: 'always' } );
	const { data: preferences } = useUserPreferences();
	const isWpcom = sessionProvider === 'wpcom';

	const modelLabel = getAiModelLabel( model );
	const credits = getCreditsLabel( isQuotaError ? null : quota, preferences?.locale );
	const canPurchaseCredits =
		isWpcom &&
		!! quota &&
		credits.hasCredits &&
		getStudioCodeAiAccessState( quota ) === 'available' &&
		quota.hasPaymentMethod;
	const modelDetails = [ modelLabel, getProviderDescriptor( sessionProvider ).label ];
	if ( isWpcom ) {
		modelDetails.push( credits.label );
	}
	const pickCommand = ( value: string ) => {
		onOpenChange( false );
		if ( value === 'get-credits' ) {
			onAddCredits( triggerRef );
		} else if ( value === 'connect-provider' ) {
			openSettings( 'ai' );
		} else {
			const provider = providers.find( ( id ) =>
				getAiModels( id ).some( ( item ) => item.id === value )
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
				getAiModels( provider ).map( ( { id } ): Command => {
					const { label } = getProviderDescriptor( provider );
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
						label: getAiModelLabel( id ),
						description: isModelLocked( id )
							? `${ description } · ${ __( 'Purchased credits required' ) }`
							: description,
						icon: getProviderIcon( provider ),
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
