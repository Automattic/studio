import { useI18n } from '@wordpress/react-i18n';
import { AddSiteModalContent } from 'src/modules/add-site';

export function EmptyStudio() {
	const { __ } = useI18n();

	return (
		<div className="w-full h-full flex items-center justify-center">
			<div className="w-full h-full max-w-[786px] pt-12 pb-4">
				<AddSiteModalContent />
			</div>
		</div>
	);
}
