import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
} from '@wordpress/components';
import { Icon, plus, backup, chevronRight, chevronLeft, download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { Tooltip } from 'src/components/tooltip';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { BlueprintIcon } from './blueprint-icon';

export type AddSiteFlowType =
	| 'create'
	| 'blueprint'
	| 'blueprintDeeplink'
	| 'backup'
	| 'pullRemote';
interface AddSiteOptionsProps {
	onOptionSelect: ( option: AddSiteFlowType ) => void;
}

interface OptionButtonProps {
	icon: React.ReactNode;
	title: string;
	description: string;
	onClick: () => void;
	disabled?: boolean;
	disabledTooltip?: string;
	testId?: string;
}

function OptionButton( {
	icon,
	title,
	description,
	onClick,
	disabled = false,
	disabledTooltip,
	testId,
}: OptionButtonProps ) {
	const { isRTL } = useI18n();
	const chevron = isRTL() ? chevronLeft : chevronRight;
	return (
		<Tooltip
			text={ disabledTooltip }
			disabled={ ! disabled }
			className={ cx( 'w-full max-w-[460px]' ) }
		>
			<HStack
				as="button"
				className={ cx(
					'w-full p-4 border border-gray-200 rounded-xl text-left',
					'rtl:text-right',
					'hover:border-gray-300 hover:bg-gray-50',
					'disabled:opacity-50 disabled:cursor-not-allowed'
				) }
				alignment="top"
				onClick={ onClick }
				disabled={ disabled }
				spacing={ 5 }
				data-testid={ testId }
			>
				<div className="mt-[-2px]">{ icon }</div>
				<VStack className="flex-1 gap-1.5">
					<Heading className="text-[15px]" weight="500">
						{ title }
					</Heading>
					<Text className="text-[13px] text-gray-500" weight="400">
						{ description }
					</Text>
				</VStack>
				<Icon className="mt-0.5" icon={ chevron } size={ 24 } fill="#949494" />
			</HStack>
		</Tooltip>
	);
}

export default function AddSiteOptions( { onOptionSelect }: AddSiteOptionsProps ) {
	const { __ } = useI18n();
	const { enableBlueprints } = useFeatureFlags();
	const isOffline = useOffline();
	const offlineMessage = __( "You're currently offline." );

	return (
		<VStack className="text-center w-full" alignment="top" spacing="3">
			<Heading className="text-[32px] text-gray-900" weight={ 500 }>
				{ __( 'Add a site' ) }
			</Heading>
			<Text className="text-[15px] font-light text-gray-700 w-72 mb-4">
				{ __( 'Add a clean site, start from a Blueprint or import site from a backup' ) }
			</Text>
			<OptionButton
				icon={ <Icon className="" icon={ plus } size={ 26 } fill="#3858E9" /> }
				title={ __( 'Create a site' ) }
				description={ __( 'Start with an empty site' ) }
				onClick={ () => onOptionSelect( 'create' ) }
				testId="create-site-option-button"
			/>
			{ enableBlueprints && (
				<OptionButton
					icon={ <BlueprintIcon size={ 24 } /> }
					title={ __( 'Start from a Blueprint' ) }
					description={ __( 'Choose a featured Blueprint or use your own' ) }
					onClick={ () => onOptionSelect( 'blueprint' ) }
					disabled={ isOffline }
					disabledTooltip={ offlineMessage }
				/>
			) }
			<OptionButton
				icon={ <Icon icon={ download } size={ 24 } fill="#3858E9" /> }
				title={ __( 'Import an existing website' ) }
				description={ __( 'Download directly from WordPress.com or Pressable' ) }
				onClick={ () => onOptionSelect( 'pullRemote' ) }
			/>
			<OptionButton
				icon={ <Icon icon={ backup } size={ 24 } fill="#3858E9" /> }
				title={ __( 'Import from a backup' ) }
				description={ __( 'Start a site from a backup' ) }
				onClick={ () => onOptionSelect( 'backup' ) }
			/>
		</VStack>
	);
}
