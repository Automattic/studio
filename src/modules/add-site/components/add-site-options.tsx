import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
} from '@wordpress/components';
import { Icon, create, backup, chevronRight, chevronLeft } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { BlueprintIcon } from './blueprint-icon';

interface AddSiteOptionsProps {
	onOptionSelect: ( option: 'create' | 'blueprint' | 'backup' ) => void;
}

interface OptionButtonProps {
	icon: React.ReactNode;
	title: string;
	description: string;
	onClick: () => void;
	disabled?: boolean;
}

function OptionButton( {
	icon,
	title,
	description,
	onClick,
	disabled = false,
}: OptionButtonProps ) {
	const { isRTL } = useI18n();
	const chevron = isRTL() ? chevronLeft : chevronRight;
	return (
		<HStack
			as="button"
			className={ cx(
				'w-full max-w-xl p-5 border border-gray-200 rounded-xl text-left',
				'rtl:text-right',
				'hover:border-gray-300 hover:bg-gray-50',
				'disabled:opacity-50 disabled:cursor-not-allowed'
			) }
			alignment="top"
			onClick={ onClick }
			disabled={ disabled }
			spacing={ 5 }
		>
			{ icon }
			<VStack className="flex-1">
				<Heading className="text-xl" weight="500">
					{ title }
				</Heading>
				<Text className="text-base text-gray-500" weight="300">
					{ description }
				</Text>
			</VStack>
			<Icon className="mt-0.5" icon={ chevron } size={ 24 } fill="#949494" />
		</HStack>
	);
}

export default function AddSiteOptions( { onOptionSelect }: AddSiteOptionsProps ) {
	const { __ } = useI18n();
	const isOffline = useOffline();

	return (
		<VStack className="text-center w-full" alignment="top" spacing="3">
			<Heading className="text-4xl">{ __( 'Add a site' ) }</Heading>
			<Text className="text-xl font-light text-gray-500 w-96 mb-10">
				{ __( 'Add a clean site, start from a blueprint or import site from a backup' ) }
			</Text>
			<OptionButton
				icon={ <Icon className="" icon={ create } size={ 32 } fill="#3858E9" /> }
				title={ __( 'Create a site' ) }
				description={ __( 'Create a clean site' ) }
				onClick={ () => onOptionSelect( 'create' ) }
			/>
			<OptionButton
				icon={ <BlueprintIcon size={ 32 } /> }
				title={ __( 'Start from a blueprint' ) }
				description={ __( 'Choose one from the list or select your own' ) }
				onClick={ () => onOptionSelect( 'blueprint' ) }
				disabled={ isOffline }
			/>
			<OptionButton
				icon={ <Icon icon={ backup } size={ 32 } fill="#3858E9" /> }
				title={ __( 'Import from a backup' ) }
				description={ __( 'Start a site from a backup' ) }
				onClick={ () => onOptionSelect( 'backup' ) }
			/>
		</VStack>
	);
}
