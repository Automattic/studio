import { __, isRTL } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useLocalMediaDataUrl } from '@/data/queries/use-local-media';
import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDismissButton,
	IconButton,
} from '@/lib/ui';
import styles from './style.module.css';

export function QuestionOptionViewer( {
	options,
	index,
	onIndexChange,
	onChoose,
}: {
	options: Array< { label: string; description: string; image?: string } >;
	index: number | null;
	onIndexChange: ( index: number | null ) => void;
	onChoose?: ( label: string ) => void;
} ) {
	const option = index === null ? undefined : options[ index ];
	const localFileQuery = useLocalMediaDataUrl( option?.image ?? null );
	const step = ( delta: number ) =>
		index !== null && onIndexChange( ( index + delta + options.length ) % options.length );
	const previousIcon = isRTL() ? <ChevronRightIcon /> : <ChevronLeftIcon />;
	const nextIcon = isRTL() ? <ChevronLeftIcon /> : <ChevronRightIcon />;

	return (
		<Dialog
			open={ option !== undefined }
			onOpenChange={ ( open ) => ! open && onIndexChange( null ) }
		>
			<DialogContent
				className={ styles.questionOptionZoomPopup }
				aria-label={ option?.label }
				onKeyDown={ ( event ) => {
					if ( event.key === 'ArrowLeft' || event.key === 'ArrowRight' ) {
						event.preventDefault();
						step( ( event.key === 'ArrowRight' ) !== isRTL() ? 1 : -1 );
					}
				} }
			>
				{ localFileQuery.data ? (
					<img
						className={ styles.questionOptionZoomImage }
						src={ localFileQuery.data }
						alt={ option?.label }
					/>
				) : null }
				<DialogClose
					className={ styles.questionOptionZoomClose }
					render={ <DialogDismissButton variant="ghost" size="icon-2xs" /> }
				/>
				<IconButton
					className={ clsx( styles.questionOptionZoomStep, styles.questionOptionZoomPrevious ) }
					size="icon-2xs"
					icon={ previousIcon }
					label={ __( 'Previous option' ) }
					onClick={ () => step( -1 ) }
				/>
				<IconButton
					className={ clsx( styles.questionOptionZoomStep, styles.questionOptionZoomNext ) }
					size="icon-2xs"
					icon={ nextIcon }
					label={ __( 'Next option' ) }
					onClick={ () => step( 1 ) }
				/>
				{ option && onChoose ? (
					<Button
						className={ styles.questionOptionZoomChoose }
						variant="accent"
						size="header"
						onClick={ () => {
							onIndexChange( null );
							onChoose( option.label );
						} }
					>
						{ __( 'Choose' ) }
					</Button>
				) : null }
			</DialogContent>
		</Dialog>
	);
}
