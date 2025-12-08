import { useAddSiteContext } from 'src/components/add-site-provider';
import { AddSiteModalContent } from 'src/modules/add-site';

export function NoStudioSites() {
	const {
		blueprintPreferredVersions,
		setBlueprintPreferredVersions,
		blueprintDeeplinkWarnings,
		setBlueprintDeeplinkWarnings,
		isDeeplinkFlow,
		setIsDeeplinkFlow,
		clearDeeplinkState,
		addSiteProps,
	} = useAddSiteContext();

	return (
		<main className="bg-white h-full flex items-center justify-center overflow-hidden z-10">
			<div className="h-full w-full pt-14 pb-4 max-w-[786px]">
				<AddSiteModalContent
					blueprintPreferredVersions={ blueprintPreferredVersions }
					setBlueprintPreferredVersions={ setBlueprintPreferredVersions }
					blueprintDeeplinkWarnings={ blueprintDeeplinkWarnings }
					setBlueprintDeeplinkWarnings={ setBlueprintDeeplinkWarnings }
					isDeeplinkFlow={ isDeeplinkFlow }
					setIsDeeplinkFlow={ setIsDeeplinkFlow }
					onSubmit={ clearDeeplinkState }
					addSiteProps={ addSiteProps }
				/>
			</div>
		</main>
	);
}
