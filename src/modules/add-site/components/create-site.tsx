import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { AllowedPHPVersion } from 'src/lib/wordpress-provider/constants';
import {
	CreateSiteForm,
	CreateSiteFormValues,
	CreateSiteFormFeatures,
} from 'src/modules/add-site/components/create-site-form';

export interface CreateSiteProps {
	siteName: string | null;
	sitePath: string;
	phpVersion: string;
	wpVersion: string;
	onSubmit: ( values: CreateSiteFormValues ) => void;
	handlePathSelectorClick: () => void;
	error: string;
	doesPathContainWordPress: boolean;
	existingDomainNames?: string[];
	blueprintPreferredVersions?: { php?: string; wp?: string };
}

export default function CreateSite( {
	siteName,
	sitePath,
	phpVersion,
	wpVersion,
	onSubmit,
	handlePathSelectorClick,
	error,
	doesPathContainWordPress,
	existingDomainNames = [],
	blueprintPreferredVersions,
}: CreateSiteProps ) {
	const { __ } = useI18n();

	const features = useMemo< CreateSiteFormFeatures >(
		() => ( {
			pathSelection: {
				enabled: true,
				onSelectPath: handlePathSelectorClick,
				doesPathContainWordPress,
				error,
			},
			customDomain: {
				enabled: true,
				existingDomainNames,
			},
			...( blueprintPreferredVersions && {
				blueprintVersions: {
					enabled: true,
					preferredVersions: blueprintPreferredVersions,
				},
			} ),
		} ),
		[
			handlePathSelectorClick,
			doesPathContainWordPress,
			error,
			existingDomainNames,
			blueprintPreferredVersions,
		]
	);

	const initialValues = useMemo(
		() => ( {
			siteName: siteName || '',
			sitePath,
			phpVersion: phpVersion as AllowedPHPVersion,
			wpVersion,
		} ),
		[ siteName, sitePath, phpVersion, wpVersion ]
	);

	return (
		<VStack className="w-full max-w-[402px] mx-auto text-black" spacing={ 6 }>
			<Heading className="text-[32px] text-gray-900 text-center" weight={ 500 }>
				{ __( 'Add a site' ) }
			</Heading>

			<CreateSiteForm features={ features } initialValues={ initialValues } onSubmit={ onSubmit } />
		</VStack>
	);
}
