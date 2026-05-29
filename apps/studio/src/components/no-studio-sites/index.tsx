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
		setBlueprintSuggestedDomain,
		setBlueprintSuggestedHttps,
		setBlueprintSuggestedSiteName,
		setBlueprintRequiresCustomDomain,
		setIsDeeplinkFlow,
	} = addSiteProps;

	useBlueprintDeeplink( {
		isAnySiteProcessing,
		setSelectedBlueprint,
		setPhpVersion: setDeeplinkPhpVersion,
		setWpVersion: setDeeplinkWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintSuggestedDomain,
		setBlueprintSuggestedHttps,
		setBlueprintSuggestedSiteName,
		setBlueprintRequiresCustomDomain,
		setIsDeeplinkFlow,
	} );

	return (
		<main className="bg-frame text-frame-text h-full flex flex-col overflow-hidden z-10">
			<div className="flex-1 min-h-0 w-full pt-14 px-6 pb-6 overflow-y-auto">
				<AddSiteModalContent addSiteProps={ addSiteProps } />
			</div>
		</main>
	);
}
