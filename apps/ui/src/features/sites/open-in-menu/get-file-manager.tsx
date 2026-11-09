import { __ } from '@wordpress/i18n';
import { AppIcon } from '@/features/sites/app-icon';
import { FolderIcon } from '@/lib/icons';
import type { ReactElement } from 'react';

export function getFileManager(): { label: string; logo: ReactElement } {
	const platform = navigator.platform.toLowerCase();
	if ( platform.includes( 'win' ) ) {
		return { label: __( 'File Explorer' ), logo: <FolderIcon /> };
	}
	if ( platform.includes( 'linux' ) ) {
		return { label: __( 'File manager' ), logo: <FolderIcon /> };
	}
	return {
		label: __( 'Finder' ),
		logo: <AppIcon app="finder" fallback={ <FolderIcon /> } />,
	};
}
