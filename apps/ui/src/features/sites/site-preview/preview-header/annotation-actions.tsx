import {
	AnnotationCancelButton,
	hasAnnotationContent,
	isStagedAnnotation,
	isAnnotationsBusy,
	setAnnotating,
	useSiteAnnotations,
} from '@/features/annotations';
import { AnnotateButton } from './annotate-button';
import styles from './style.module.css';

export function PreviewAnnotationActions( {
	siteId,
	annotation,
	onSend,
}: {
	siteId: string;
	annotation: { active: boolean; disabled: boolean; disabledReason?: string; onClick: () => void };
	onSend?: () => void;
} ) {
	const annotations = useSiteAnnotations( siteId );
	return (
		<AnnotateButton
			{ ...annotation }
			cancel={
				<AnnotationCancelButton
					siteId={ siteId }
					iconOnly
					size="icon-sm"
					className={ styles.annotationCancel }
				/>
			}
			send={ {
				count: annotations.notes.filter( hasAnnotationContent ).length,
				visible: annotations.notes.some( isStagedAnnotation ),
				disabled: isAnnotationsBusy( annotations ) || ! onSend,
				loading: Boolean( annotations.sending ),
				onClick: () => {
					onSend?.();
					setAnnotating( siteId, false );
				},
			} }
		/>
	);
}
