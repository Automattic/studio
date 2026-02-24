import { BlueprintValidationWarning } from '@studio/common/lib/blueprint-validation';
import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Icon,
} from '@wordpress/components';
import { check, link, upload, starFilled } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { Blueprint } from 'src/stores/wpcom-api';
import { BlueprintWarningNotice } from './blueprint-warning-notice';

export type BlueprintSource = 'deeplink' | 'file' | 'featured';

interface BlueprintDetailsProps {
	selectedBlueprint?: Blueprint;
	warnings?: BlueprintValidationWarning[];
	source?: BlueprintSource;
}

export default function BlueprintDetails( {
	selectedBlueprint,
	warnings,
	source = 'deeplink',
}: BlueprintDetailsProps ) {
	const { __ } = useI18n();

	const blueprintTitle = selectedBlueprint?.title || __( 'Blueprint' );
	const blueprintDescription = selectedBlueprint?.excerpt || '';

	const sourceConfig = {
		deeplink: { icon: link, label: __( 'Blueprint loaded from URL' ) },
		file: { icon: upload, label: __( 'Blueprint loaded from file' ) },
		featured: { icon: starFilled, label: __( 'Featured Blueprint' ) },
	};

	const { icon: sourceIcon, label: sourceLabel } = sourceConfig[ source ];

	return (
		<VStack className="text-center w-full" alignment="top" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-frame-text mb-5" weight={ 500 }>
				{ __( 'Start from a Blueprint' ) }
			</Heading>
			<BlueprintWarningNotice
				warnings={ warnings }
				fileName={ blueprintTitle }
				className="w-full max-w-4xl mx-auto"
			/>
			<VStack className="max-w-[400px] min-w-[350px] mx-auto mt-16 justify-start" spacing={ 0 }>
				<VStack className="w-full max-h-[172px] p-6 border rounded-t-lg border-frame-border justify-start">
					<HStack className="h-full justify-start" alignment="top" spacing={ 4 }>
						<Icon className="fill-a8c-blue-50 shrink-0" icon={ check } size={ 29 } />
						<VStack alignment="left" spacing={ 1 }>
							<Text className="text-lg font-medium text-frame-text text-left line-clamp-2">
								{ blueprintTitle }
							</Text>
							<VStack alignment="left" spacing={ 4 }>
								{ blueprintDescription && (
									<Text
										className="text-[13px] text-frame-text-secondary line-clamp-3"
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
					className="w-full bg-frame-surface border border-frame-border border-t-0 rounded-b-lg py-[14px] pe-[14px] ps-[68px] justify-start"
				>
					<Icon icon={ sourceIcon } size={ 18 } className="fill-frame-text-secondary" />
					<Text className="text-[13px] text-frame-text">{ sourceLabel }</Text>
				</HStack>
			</VStack>
		</VStack>
	);
}
