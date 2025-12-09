import { useCallback } from 'react';
import { useAddSite } from 'src/hooks/use-add-site';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { AddSiteModalContent } from 'src/modules/add-site';
import { useBlueprintDeeplink } from 'src/modules/add-site/hooks/use-blueprint-deeplink';

export function NoStudioSites() {
	const addSiteProps = useAddSite();
	const { sites } = useSiteDetails();
	const { importState } = useImportExport();

	const {
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
		setIsDeeplinkFlow,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
	} = addSiteProps;

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const clearDeeplinkState = useCallback( () => {
		setIsDeeplinkFlow( false );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions( undefined );
		setBlueprintDeeplinkWarnings( undefined );
	}, [
		setIsDeeplinkFlow,
		setSelectedBlueprint,
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
	] );

	useBlueprintDeeplink( {
		isAnySiteProcessing,
		openModal: () => {},
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
		navigateToBlueprintDeeplink: () => setIsDeeplinkFlow( true ),
	} );

	return (
		<main className="bg-white h-full flex items-center justify-center overflow-hidden z-10">
			<div className="h-full w-full pt-14 pb-4 max-w-[786px]">
				<AddSiteModalContent onSubmit={ clearDeeplinkState } addSiteProps={ addSiteProps } />
			</div>
		</main>
	);
}
