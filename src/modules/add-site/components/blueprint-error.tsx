import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
} from '@wordpress/components';
import { Icon, warning } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';

interface BlueprintErrorProps {
	errorMessage: string;
	onBack: () => void;
}

export default function BlueprintError( { errorMessage, onBack }: BlueprintErrorProps ) {
	const { __ } = useI18n();

	return (
		<VStack className="w-full max-w-[402px] mx-auto text-center" spacing={ 6 }>
			<VStack spacing={ 4 } alignment="center">
				<Icon icon={ warning } size={ 48 } className="text-red-500" />
				<Heading className="text-[32px] text-gray-900" weight={ 500 }>
					{ __( 'Blueprint Error' ) }
				</Heading>
				<Text className="text-[15px] text-gray-700">
					{ __( 'There was an error loading the blueprint:' ) }
				</Text>
				<VStack
					className="w-full p-4 bg-red-50 border border-red-200 rounded-lg text-left"
					spacing={ 2 }
				>
					<Text className="text-sm font-medium text-red-800">{ __( 'Error details:' ) }</Text>
					<Text className="text-sm text-red-700 whitespace-pre-wrap break-words">
						{ errorMessage }
					</Text>
				</VStack>
			</VStack>
			<HStack spacing={ 3 } alignment="center">
				<Button variant="primary" onClick={ onBack }>
					{ __( 'Go back' ) }
				</Button>
			</HStack>
		</VStack>
	);
}
