import {
	__experimentalHeading as Heading,
	__experimentalText as Text,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useOffline } from 'src/hooks/use-offline';
import { getAppGlobals } from 'src/lib/app-globals';

export default function SiteSpec() {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const siteSpecUrl = getAppGlobals().siteSpecUrl?.trim();

	return (
		<div className="flex flex-col w-full h-full min-h-0">
			<div className="text-center">
				<Heading className="text-[32px] text-gray-900" weight={ 500 }>
					{ __( 'Build with AI' ) }
				</Heading>
				<Text className="text-[15px] font-light text-gray-700 max-w-md mx-auto mt-2">
					{ __( 'Start with AI to generate a site.' ) }
				</Text>
			</div>
			<div className="flex-1 min-h-0 mt-6">
				{ isOffline ? (
					<div className="h-full w-full flex items-center justify-center border border-gray-200 rounded-xl bg-gray-50">
						<Text className="text-[14px] text-gray-600">
							{ __( 'Building with AI requires an internet connection.' ) }
						</Text>
					</div>
				) : siteSpecUrl ? (
					<iframe
						title={ __( 'Site Spec' ) }
						src={ siteSpecUrl }
						className="w-full h-full border border-gray-200 rounded-xl bg-white"
					/>
				) : (
					<div className="h-full w-full flex flex-col items-center justify-center gap-2 border border-dashed border-gray-200 rounded-xl bg-gray-50">
						<Text className="text-[14px] text-gray-600">
							{ __( 'Site Spec is not available in this build.' ) }
						</Text>
						<Text className="text-[13px] text-gray-500">
							{ __( 'Set SITE_SPEC_URL to enable the embed.' ) }
						</Text>
					</div>
				) }
			</div>
		</div>
	);
}
