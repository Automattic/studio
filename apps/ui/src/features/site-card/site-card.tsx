import { __, sprintf } from '@wordpress/i18n';
import { FieldGroup, PreviewFrame, PreviewImage } from '@/lib/ui';
import { RelativeTime } from './relative-time';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function getWebsiteThumbnailUrl( url: string ) {
	return `https://s0.wp.com/mshots/v1/${ encodeURIComponent( url ) }?w=320&h=200`;
}

export function SiteCard( {
	title,
	description,
	thumbnailUrl,
	actions,
	updatedAt,
	active = true,
}: {
	title: ReactNode;
	description?: ReactNode;
	thumbnailUrl?: string | null;
	actions?: ReactNode;
	updatedAt?: string | number | null;
	active?: boolean;
} ) {
	return (
		<FieldGroup variant="settings" className={ styles.card }>
			<div className={ styles.row }>
				<PreviewFrame className={ styles.thumbnail }>
					<PreviewImage key={ thumbnailUrl } src={ thumbnailUrl ?? undefined } alt="" />
				</PreviewFrame>
				<div className={ styles.identity }>
					<div className={ styles.title }>{ title }</div>
					{ updatedAt || description ? (
						<div className={ styles.description }>
							{ updatedAt ? (
								<RelativeTime
									timestamp={ updatedAt }
									active={ active }
									compact
									/* translators: %s: relative time since the site was updated. */
									formatLabel={ ( time ) => sprintf( __( 'Updated %s' ), time ) }
								/>
							) : (
								description
							) }
						</div>
					) : null }
				</div>
				{ actions }
			</div>
		</FieldGroup>
	);
}
