import { useAddSite } from 'src/hooks/use-add-site';
import { AddSiteModalContent } from 'src/modules/add-site';
import { useBlueprintDeeplink } from 'src/modules/add-site/hooks/use-blueprint-deeplink';

export function NoStudioSites() {
	const addSiteProps = useAddSite();
	const {
		isAnySiteProcessing,
		setSelectedBlueprint,
		setDeeplinkPhpVersion,
		setDeeplinkWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintWarnings,
		setBlueprintSuggestedDomain,
		setBlueprintSuggestedHttps,
		setBlueprintSuggestedSiteName,
		setIsDeeplinkFlow,
	} = addSiteProps;

	useBlueprintDeeplink( {
		isAnySiteProcessing,
		setSelectedBlueprint,
		setPhpVersion: setDeeplinkPhpVersion,
		setWpVersion: setDeeplinkWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintWarnings,
		setBlueprintSuggestedDomain,
		setBlueprintSuggestedHttps,
		setBlueprintSuggestedSiteName,
		setIsDeeplinkFlow,
	} );

	return (
		<main className="bg-white h-full flex overflow-hidden z-10">
			<div className="h-full w-full pt-14 px-6 pb-6">
				<AddSiteModalContent addSiteProps={ addSiteProps } />
			</div>
		</main>
	);
}
