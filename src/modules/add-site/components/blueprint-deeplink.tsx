import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Icon,
} from '@wordpress/components';
import { check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { Blueprint } from 'src/stores/wpcom-api';

interface BlueprintDeeplinkProps {
	selectedBlueprint?: Blueprint;
}

export default function BlueprintDeeplink( { selectedBlueprint }: BlueprintDeeplinkProps ) {
	const { __ } = useI18n();

	const blueprintTitle = selectedBlueprint?.title || __( 'Blueprint' );
	const blueprintDescription = selectedBlueprint?.excerpt || '';

	return (
		<VStack className="text-center w-full" alignment="top" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-gray-900 mb-[59px]" weight={ 500 }>
				{ __( 'Start from a Blueprint' ) }
			</Heading>

			<div className="w-full max-w-[400px] h-[200px] mx-auto p-12 border-2 rounded-xl border-gray-300 bg-gray-50">
				<VStack className="items-center justify-center h-full" spacing={ 2 }>
					<HStack spacing={ 2 } alignment="center" className="text-green-600">
						<Icon icon={ check } size={ 24 } />
						<Text className="text-base font-medium text-gray-900">
							{ __( 'Blueprint selected' ) }
						</Text>
					</HStack>
					<Text className="text-base font-medium text-gray-900 max-w-md px-4" weight={ 400 }>
						{ blueprintTitle }
					</Text>
					{ blueprintDescription && (
						<Text className="text-sm text-gray-600 max-w-md px-4 line-clamp-2">
							{ blueprintDescription }
						</Text>
					) }
				</VStack>
			</div>
		</VStack>
	);
}
