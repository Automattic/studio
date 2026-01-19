import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Icon,
} from '@wordpress/components';
import { check, link } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import { Blueprint } from 'src/stores/wpcom-api';
import { BlueprintWarningNotice } from './blueprint-warning-notice';

interface BlueprintDeeplinkProps {
	selectedBlueprint?: Blueprint;
	warnings?: BlueprintValidationWarning[];
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
			<Heading className="text-center text-[32px] text-gray-900 mb-5" weight={ 500 }>
				{ __( 'Start from a Blueprint' ) }
			</Heading>
			<BlueprintWarningNotice
				warnings={ warnings }
				fileName={ blueprintTitle }
				className="w-full max-w-4xl mx-auto"
			/>
			<VStack className="max-w-[400px] min-w-[350px] mx-auto mt-16 justify-start" spacing={ 0 }>
				<VStack className="w-full max-h-[172px] p-6 border rounded-t-lg border-gray-200 justify-start">
					<HStack className="h-full justify-start" alignment="top" spacing={ 4 }>
						<Icon className="fill-a8c-blue-50 shrink-0" icon={ check } size={ 29 } />
						<VStack alignment="left" spacing={ 1 }>
							<Text className="text-lg font-medium text-gray-900">
								{ __( 'Blueprint selected' ) }
							</Text>
							<VStack alignment="left" spacing={ 4 }>
								<Text className="text-[13px] text-[#50575E]" weight={ 400 }>
									{ blueprintTitle }
								</Text>
								{ blueprintDescription && (
									<Text
										className="text-[13px] text-a8c-gray-700 line-clamp-3"
										weight={ 400 }
										align="start"
									>
										{ blueprintDescription }
									</Text>
								) }
							</VStack>
						</VStack>
					</HStack>
				</VStack>
				<HStack
					alignment="start"
					className="w-full bg-[#FAFAFA] border border-t-0 rounded-b-lg py-[14px] pe-[14px] ps-[68px] justify-start"
				>
					<Icon icon={ link } size={ 18 } />
					<Text className="text-[13px] text-a8c-gray-800">
						{ __( 'Blueprint loaded from URL' ) }
					</Text>
				</HStack>
			</VStack>
		</VStack>
	);
}
