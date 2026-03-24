import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';

export function InstalledBadge() {
	const { __ } = useI18n();
	return (
		<span className="inline-flex items-center gap-1 text-[11px] text-green-900 bg-green-50 dark:!text-green-300 dark:bg-green-950 px-2 py-0.5 rounded-full">
			<Icon className="dark:fill-green-300" icon={ check } size={ 12 } />
			{ __( 'Installed' ) }
		</span>
	);
}
