import { useAddSite } from 'src/hooks/use-add-site';
import { AddSiteModalContent } from 'src/modules/add-site';

export function NoStudioSites() {
	const addSiteProps = useAddSite();

	return (
		<main className="bg-white h-full flex items-center justify-center overflow-hidden z-10">
			<div className="h-full w-full pt-14 pb-4 max-w-[786px]">
				<AddSiteModalContent addSiteProps={ addSiteProps } />
			</div>
		</main>
	);
}
