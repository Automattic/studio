import { useI18n } from '@wordpress/react-i18n';
import { AddSiteModalContent } from 'src/modules/add-site';

export function EmptyStudio() {
	const { __ } = useI18n();

	return (
		<main className="bg-white h-full flex items-center justify-center overflow-hidden z-10">
			<div className="w-full max-w-[786px]">
				<AddSiteModalContent />
			</div>
		</main>
	);
}
