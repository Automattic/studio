import { useI18n } from '@wordpress/react-i18n';

export function SiteLoadingIndicator() {
	const { __ } = useI18n();

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto"></div>
	);
}
