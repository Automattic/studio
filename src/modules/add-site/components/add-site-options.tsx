import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
} from '@wordpress/components';
import { Icon, create, preformatted, backup, chevronRight } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useOffline } from 'src/hooks/use-offline';

interface AddSiteOptionsProps {
	onOptionSelect: ( option: 'create' | 'blueprint' | 'backup' ) => void;
}

interface OptionButtonProps {
	icon: JSX.Element;
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
	return (
		<HStack
			as="button"
			className="w-full max-w-xl p-5 border border-gray-200 rounded-xl text-left hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
			alignment="top"
			onClick={ onClick }
			disabled={ disabled }
		>
			<Icon className="mt-0.5" icon={ icon } size={ 24 } fill="#3858E9" />
			<VStack className="flex-1">
				<Heading className="text-xl" weight="500">
					{ title }
				</Heading>
				<Text className="text-base text-gray-500" weight="300">
					{ description }
				</Text>
			</VStack>
			<Icon className="mt-0.5" icon={ chevronRight } size={ 24 } fill="#949494" />
		</HStack>
	);
}

export default function AddSiteOptions( { onOptionSelect }: AddSiteOptionsProps ) {
	const { __ } = useI18n();
	const isOffline = useOffline();

	return (
		<VStack className="text-center" alignment="center" spacing="3">
			<Heading className="text-4xl">{ __( 'Add a site' ) }</Heading>
			<Text className="text-xl font-light text-gray-500 w-96 mb-10">
				{ __( 'Add a clean site, start from a blueprint or import site from a backup' ) }
			</Text>
			<OptionButton
				icon={ create }
				title={ __( 'Create a site' ) }
				description={ __( 'Create a clean site' ) }
				onClick={ () => onOptionSelect( 'create' ) }
			/>
			<OptionButton
				icon={ preformatted }
				title={ __( 'Start from a blueprint' ) }
				description={ __( 'Choose one from the list or select your own' ) }
				onClick={ () => onOptionSelect( 'blueprint' ) }
				disabled={ isOffline }
			/>
			<OptionButton
				icon={ backup }
				title={ __( 'Import from a backup' ) }
				description={ __( 'Start a site from a backup' ) }
				onClick={ () => onOptionSelect( 'backup' ) }
			/>
		</VStack>
	);
}
