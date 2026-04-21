import { __ } from '@wordpress/i18n';
import { chevronLeft, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import styles from './publish-picker-view.module.css';
import { stripProtocol } from './utils';
import type { SyncSite } from '@/data/core';

type Props = {
	pickableSites: SyncSite[] | undefined;
	isLoading: boolean;
	onBack: () => void;
	onPickSite: ( site: SyncSite ) => void;
	onCreateNew: () => void;
};

export function PublishPickerView( {
	pickableSites,
	isLoading,
	onBack,
	onPickSite,
	onCreateNew,
}: Props ) {
	return (
		<div className={ styles.picker }>
			<div className={ styles.header }>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ chevronLeft }
					label={ __( 'Back' ) }
					onClick={ onBack }
				/>
				<span className={ styles.title }>{ __( 'Publish this site' ) }</span>
			</div>
			<div className={ styles.body }>
				{ isLoading ? (
					<div className={ styles.status }>{ __( 'Loading sites…' ) }</div>
				) : pickableSites && pickableSites.length > 0 ? (
					<ul className={ styles.list }>
						{ pickableSites.map( ( candidate ) => (
							<li key={ candidate.id }>
								<button
									type="button"
									className={ styles.item }
									onClick={ () => onPickSite( candidate ) }
								>
									<span className={ styles.itemName }>{ candidate.name || candidate.url }</span>
									<span className={ styles.itemUrl }>{ stripProtocol( candidate.url ) }</span>
								</button>
							</li>
						) ) }
					</ul>
				) : (
					<div className={ styles.status }>
						{ __( 'No WordPress.com sites available to publish to.' ) }
					</div>
				) }
			</div>
			<button type="button" className={ styles.create } onClick={ onCreateNew }>
				<Icon icon={ plus } size={ 16 } />
				<span>{ __( 'Create a new WordPress.com site…' ) }</span>
			</button>
		</div>
	);
}
