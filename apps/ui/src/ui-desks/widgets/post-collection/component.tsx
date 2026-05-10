import { __ } from '@wordpress/i18n';
import { LoadingPlaceholder } from '@/ui-desks/components';
import styles from './style.module.css';
import type { PostCollectionWidgetProps } from './types';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

export function PostCollectionWidgetComponent( {
	runtime,
}: DeskWidgetComponentProps< PostCollectionWidgetProps > ) {
	if ( runtime.resolutionState !== 'loading' ) {
		return null;
	}

	const isFrontCard = runtime.stackOrder === 0;

	return (
		<section
			className={ styles.loading }
			data-front={ isFrontCard ? 'true' : 'false' }
			aria-busy={ isFrontCard ? 'true' : undefined }
		>
			<LoadingPlaceholder text={ isFrontCard ? __( 'Loading posts' ) : undefined } />
		</section>
	);
}
