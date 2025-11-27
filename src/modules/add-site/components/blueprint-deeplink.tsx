import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Icon,
} from '@wordpress/components';
import { check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { Blueprint } from 'src/stores/wpcom-api';
import { BlueprintWarningNotice } from './blueprints';

interface BlueprintDeeplinkProps {
	selectedBlueprint?: Blueprint;
	warnings?: Array< { feature: string; reason: string } >;
}

export default function BlueprintDeeplink( {
	selectedBlueprint,
	warnings,
}: BlueprintDeeplinkProps ) {
	const { __ } = useI18n();

	const blueprintTitle = selectedBlueprint?.title || __( 'Blueprint' );
	const blueprintDescription = selectedBlueprint?.excerpt || '';

	return (
		<VStack className="text-center w-full" alignment="top" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-gray-900 mb-[59px]" weight={ 500 }>
				{ __( 'Start from a Blueprint' ) }
			</Heading>

			<BlueprintWarningNotice
				warnings={ warnings }
				fileName={ blueprintTitle }
				className="w-full max-w-4xl mx-auto mb-4"
			/>

			<div className="w-full max-w-[400px] h-[250px] mx-auto p-12 border-2 rounded-xl border-gray-300 bg-gray-50">
				<VStack className="items-center justify-center h-full" spacing={ 2 }>
					<Icon icon={ check } size={ 24 } className="text-green-600" />
					<Text className="text-xl font-medium text-gray-900">{ __( 'Blueprint selected' ) }</Text>
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
