import {
	AI_EFFORT_LEVELS,
	aiModelSupportsEffort,
	getAiEffortLabel,
	getAiModelLabel,
	isAiEffortLevel,
	type AiEffortLevel,
} from '@studio/agent/protocol/models';
import {
	AI_PROVIDER_LABELS,
	getAiProviderModels,
	type AiProviderId,
} from '@studio/agent/protocol/providers';
import { getStudioCodeAiAccessState } from '@studio/common/lib/studio-assistant-quota';
import { __, sprintf } from '@wordpress/i18n';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, GaugeIcon, PlugIcon } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import {
	getCreditsLabel,
	getEffortDescription,
	getModelDescription,
} from '@/features/composer/model-options';
import { PlusIcon, ChevronDownIcon, ChatGptIcon, ClaudeIcon, WordPressIcon } from '@/lib/icons';
import { Button, CommandSheet, Popover, type Command, type CommandGroup } from '@/lib/ui';
import styles from './style.module.css';
import type { AiModelId } from '@/data/core';

// Who makes each provider's models, as the picker names and marks them. Brand
// names, not translated.
const PROVIDER_BRANDS = {
	wpcom: { name: 'WordPress', icon: WordPressIcon },
	'anthropic-api-key': { name: 'Claude', icon: ClaudeIcon },
	chatgpt: { name: 'ChatGPT', icon: ChatGptIcon },
} satisfies Record< AiProviderId, { name: string; icon: Command[ 'icon' ] } >;

interface ModelPickerProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	model: AiModelId;
	// The chat's reasoning effort, offered on a second level for models that let the user choose.
	effort: AiEffortLevel;
	onEffortChange: ( effort: AiEffortLevel ) => void;
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
	effort,
	onEffortChange,
	providers,
	sessionProvider,
	isModelLocked,
	disabled,
	anchor,
	onChange,
	onAddCredits,
}: ModelPickerProps ) {
	const [ highlight, setHighlight ] = useState< string >();
	// The second level, where the user picks the current model's effort.
	const [ effortOpen, setEffortOpen ] = useState( false );
	const offersEffort = aiModelSupportsEffort( model );
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
	const modelDetails = [ modelLabel, AI_PROVIDER_LABELS[ sessionProvider ] ];
	if ( offersEffort ) {
		modelDetails.push(
			sprintf(
				/* translators: %s: reasoning effort level, e.g. "Medium" */
				__( 'Effort: %s' ),
				getAiEffortLabel( effort )
			)
		);
	}
	if ( isWpcom ) {
		modelDetails.push( credits.label );
	}
	const pickCommand = ( value: string ) => {
		if ( value === 'effort' || value === 'effort-back' ) {
			setEffortOpen( value === 'effort' );
			setHighlight( value === 'effort' ? `effort:${ effort }` : 'effort' );
			return;
		}
		onOpenChange( false );
		const level = value.startsWith( 'effort:' ) ? value.slice( 'effort:'.length ) : undefined;
		if ( level !== undefined ) {
			if ( isAiEffortLevel( level ) ) {
				onEffortChange( level );
			}
		} else if ( value === 'get-credits' ) {
			onAddCredits( triggerRef );
		} else if ( value === 'connect-provider' ) {
			openSettings( 'ai' );
		} else {
			const provider = providers.find( ( id ) =>
				getAiProviderModels( id ).some( ( item ) => item.id === value )
			);
			if ( provider ) {
				onChange( provider, value as AiModelId );
			}
		}
	};
	const effortGroups: CommandGroup[] = [
		{
			label: __( 'Effort' ),
			heading: sprintf(
				/* translators: %s: model name, e.g. "Sonnet 5" */
				__( '%s effort' ),
				modelLabel
			),
			items: [
				{ value: 'effort-back', label: __( 'Back' ), icon: ChevronLeftIcon },
				...AI_EFFORT_LEVELS.map(
					( level ): Command => ( {
						value: `effort:${ level }`,
						label: getAiEffortLabel( level ),
						description: getEffortDescription( level ),
						icon: GaugeIcon,
						trailing: level === effort ? <CheckIcon aria-hidden="true" /> : undefined,
					} )
				),
			],
		},
	];
	const groups: CommandGroup[] = [
		{
			label: __( 'Models' ),
			items: providers.flatMap( ( provider ) =>
				getAiProviderModels( provider ).map( ( { id } ): Command => {
					const description = sprintf(
						/* translators: 1: the model's provider, 2: what the model is good at. */
						__( '%1$s · %2$s' ),
						PROVIDER_BRANDS[ provider ].name,
						getModelDescription( id )
					);
					return {
						value: id,
						label: getAiModelLabel( id ),
						description: isModelLocked( id )
							? `${ description } · ${ __( 'Purchased credits required' ) }`
							: description,
						icon: PROVIDER_BRANDS[ provider ].icon,
						disabled: isModelLocked( id ),
					};
				} )
			),
		},
		...( offersEffort
			? [
					{
						label: __( 'Effort' ),
						items: [
							{
								value: 'effort',
								label: __( 'Effort' ),
								description: getAiEffortLabel( effort ),
								icon: GaugeIcon,
								trailing: <ChevronRightIcon aria-hidden="true" />,
							},
						],
					},
			  ]
			: [] ),
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
					setEffortOpen( false );
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
				{ offersEffort ? (
					<span className={ styles.modelEffort }>{ getAiEffortLabel( effort ) }</span>
				) : null }
				<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
			</Popover.Trigger>
			<CommandSheet
				label={ effortOpen ? __( 'Choose an effort' ) : __( 'Choose a model' ) }
				groups={ effortOpen ? effortGroups : groups }
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
