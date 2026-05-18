import { __ } from '@wordpress/i18n';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { useActiveTheme } from '@/ui-desks/widgets/theme/use-active-theme';
import styles from './style.module.css';
import type { ThemeWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetLoadingComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

export function ThemeWidgetComponent( { id }: DeskWidgetComponentProps< ThemeWidgetProps > ) {
	const theme = useActiveTheme();

	return (
		<ThemeCard
			id={ id }
			name={ theme?.name ?? __( 'Theme' ) }
			description={ theme?.description ?? '' }
			screenshot={ theme?.screenshot ?? '' }
			isLoading={ theme === undefined }
		/>
	);
}

export function ThemeWidgetLoadingComponent(
	_props: DeskWidgetLoadingComponentProps< ThemeWidgetProps >
) {
	return (
		<ThemeCard
			name={ __( 'Theme' ) }
			description={ __( 'Loading theme files…' ) }
			screenshot=""
			isLoading
		/>
	);
}

export function ThemeWidgetThumbnailComponent(
	_props: DeskWidgetThumbnailComponentProps< ThemeWidgetProps >
) {
	return (
		<section className={ styles.thumbnail }>
			<span className={ styles.thumbnailPreview } aria-hidden />
			<span className={ styles.thumbnailText }>
				<span className={ styles.thumbnailTitle }>{ __( 'Theme' ) }</span>
				<span className={ styles.thumbnailMeta }>{ __( 'Templates, styles, patterns' ) }</span>
			</span>
		</section>
	);
}

function ThemeCard( {
	id,
	name,
	description,
	screenshot,
	isLoading,
}: {
	id?: string;
	name: string;
	description: string;
	screenshot: string;
	isLoading?: boolean;
} ) {
	return (
		<section
			className={ styles.card }
			data-is-loading={ isLoading ? 'true' : 'false' }
			data-studio-desk-widget="theme"
			data-studio-desk-widget-id={ id }
			aria-busy={ isLoading ? 'true' : undefined }
		>
			<div className={ styles.meta }>
				{ isLoading ? (
					<LoadingPlaceholder
						className={ styles.loadingPlaceholder }
						text={ __( 'Loading theme files' ) }
					/>
				) : (
					<>
						{ screenshot && (
							<img className={ styles.screenshot } src={ screenshot } alt="" draggable={ false } />
						) }
						<div className={ styles.identity }>
							<h2 className={ styles.name } dangerouslySetInnerHTML={ { __html: name } } />
							{ description && (
								<p
									className={ styles.description }
									dangerouslySetInnerHTML={ { __html: description } }
								/>
							) }
						</div>
					</>
				) }
			</div>
			<div className={ styles.stackSlot } aria-hidden />
		</section>
	);
}
