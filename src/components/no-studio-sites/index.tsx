import { AddSiteContentWithDeeplinkSupport } from 'src/modules/add-site';

export function NoStudioSites() {
	return (
		<main className="bg-white h-full flex items-center justify-center overflow-hidden z-10">
			<div className="h-full w-full pt-14 pb-4 max-w-[786px]">
				<AddSiteContentWithDeeplinkSupport />
			</div>
		</main>
	);
}
