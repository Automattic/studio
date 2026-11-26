import {
	DEFAULT_THINKING_LEVEL,
	getThinkingOptions,
	type ThinkingSetting,
} from '@studio/agent/protocol/thinking';
import { getStudioCodeAiAccessState } from '@studio/common/lib/studio-assistant-quota';
import {
	Badge,
	Button,
	CommandSheet,
	Menu,
	Popover,
	type Command,
	type CommandGroup,
} from '@studio/ds';
import { PlugIcon, PlusIcon, ChevronDownIcon, ExternalLinkIcon } from '@studio/ds/icons';
import {
	findAiModel,
	getAiModels,
	getProvider,
	PROVIDER_IDS,
	THINKING_LEVELS,
	type ProviderId,
} from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { BrainIcon } from 'lucide-react';
import { useId, useRef, useState, type ComponentType, type RefObject } from 'react';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { ProviderLogo } from '@/features/account';
import { getCreditsLabel, getModelDescription } from '@/features/composer/model-options';
import styles from './style.module.css';
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
	// How much the model thinks in this chat; without `onThinkingChange`, the menu doesn't offer it.
	thinking?: ThinkingSetting;
	onThinkingChange?: ( thinking: ThinkingSetting ) => void;
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
	thinking = 'default',
	onThinkingChange,
	onAddCredits,
}: ModelPickerProps ) {
	const [ highlight, setHighlight ] = useState< string >();
	const [ thinkingOpen, setThinkingOpen ] = useState( false );
	const listId = useId();
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

	const credits = getCreditsLabel( isQuotaError ? null : quota, preferences?.locale );
	const canPurchaseCredits =
		isWpcom &&
		!! quota &&
		credits.hasCredits &&
		getStudioCodeAiAccessState( quota ) === 'available' &&
		quota.hasPaymentMethod;
	const account = aiSettings?.accounts[ sessionProvider ];
	const { note, links = [] } = account?.connected ? account : {};
	// A provider whose plan decides which models it runs offers only those.
	const modelsOf = ( provider: ProviderId ) => {
		const account = aiSettings?.accounts[ provider ];
		return getAiModels( provider, account?.connected ? account : undefined );
	};
	const labelOf = ( provider: ProviderId, id: string ) =>
		(
			modelsOf( provider ).find( ( item ) => item.id === id ) ?? findAiModel( id )?.model
		)?.label() ?? id;
	const modelLabel = labelOf( sessionProvider, model );
	const local = getProvider( sessionProvider ).ai?.local;
	const thinkingOptions = getThinkingOptions( local );
	// A model on the user's own server thinks as the server says until the chat picks a level.
	const defaultThinking = local ? undefined : DEFAULT_THINKING_LEVEL;
	const currentThinking = thinking === 'default' ? defaultThinking : thinking;
	const modelDetails = [ modelLabel, getProvider( sessionProvider ).label ];
	if ( thinking !== 'default' ) {
		modelDetails.push(
			sprintf(
				/* translators: %s: a thinking level, such as Off */
				__( 'Thinking: %s' ),
				thinkingOptions[ thinking ].label
			)
		);
	}
	if ( isWpcom ) {
		modelDetails.push( credits.label );
	}
	if ( note ) {
		modelDetails.push( note );
	}
	const pickCommand = ( value: string ) => {
		if ( value === 'thinking' ) {
			setThinkingOpen( true );
			return;
		}
		onOpenChange( false );
		if ( value === 'get-credits' ) {
			onAddCredits( triggerRef );
		} else if ( value === 'connect-provider' ) {
			openSettings( 'providers', undefined, 'ai-providers' );
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
				modelsOf( provider ).map( ( { id, label: modelLabelOf } ): Command => {
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
						label: modelLabelOf(),
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
			label: __( 'Thinking' ),
			items:
				onThinkingChange &&
				modelsOf( sessionProvider ).find( ( { id } ) => id === model )?.thinking !== false
					? [
							{
								value: 'thinking',
								label: __( 'Thinking' ),
								description: currentThinking
									? thinkingOptions[ currentThinking ].label
									: thinkingOptions.default.description,
								icon: BrainIcon,
								trailing: <ChevronDownIcon className={ styles.flyoutChevron } />,
							},
					  ]
					: [],
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
					label: __( 'Connect AI providers' ),
					description: __( 'Choose what powers chat in WordPress Studio.' ),
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
					setThinkingOpen( false );
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
				onHighlight={ ( value, source ) => {
					setHighlight( value );
					if ( source === 'pointer' ) {
						setThinkingOpen( value === 'thinking' );
					}
				} }
				onSelect={ pickCommand }
				listRef={ listRef }
				id={ listId }
				anchor={ anchor }
				initialFocus={ listRef }
				finalFocus={ triggerRef }
			>
				<Menu.Root open={ thinkingOpen } onOpenChange={ setThinkingOpen } modal={ false }>
					<Menu.SubmenuPopup
						anchor={ () => document.getElementById( `${ listId }-thinking` ) }
						// Beside the row, or above it when the window leaves no room on either side.
						collisionAvoidance={ { side: 'flip', align: 'shift', fallbackAxisSide: 'start' } }
						finalFocus={ listRef }
					>
						<Menu.RadioGroup
							aria-label={ __( 'Thinking' ) }
							value={ currentThinking ?? '' }
							onValueChange={ ( picked: ThinkingSetting ) => {
								onOpenChange( false );
								onThinkingChange?.( picked );
							} }
						>
							{ THINKING_LEVELS.map( ( id ) => (
								<Menu.RadioItem key={ id } value={ id }>
									{ thinkingOptions[ id ].label }
									{ id === defaultThinking ? (
										<Badge size="xs" variant="muted">
											{ __( 'Default' ) }
										</Badge>
									) : null }
								</Menu.RadioItem>
							) ) }
						</Menu.RadioGroup>
					</Menu.SubmenuPopup>
				</Menu.Root>
			</CommandSheet>
		</Popover.Root>
	);
}
