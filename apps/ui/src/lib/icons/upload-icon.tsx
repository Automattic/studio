import { ImportIcon } from './import-icon';
import type { ComponentProps } from 'react';

export function UploadIcon( props: ComponentProps< 'svg' > ) {
	return <ImportIcon { ...props } arrowDirection="up" />;
}
