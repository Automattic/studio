import { Icon } from '@wordpress/components';
import { check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import wpcomLogo from '../../assets/wpcom-logo.svg';
import Button from './button';
import { SyncTabImage } from './sync-tab-image';

function SiteSyncDesription( { children }: PropsWithChildren< { selectedSite: SiteDetails } > ) {
	const { __ } = useI18n();
	return (
		<div className="flex justify-between max-w-3xl gap-4">
			<div className="flex flex-col p-8">
				<div className="flex items-center mb-1">
					<div className="a8c-subtitle">{ __( 'Sync with' ) }</div>
					<img src={ wpcomLogo } alt="WordPress.com Logo" className="ml-2 h-5" />
				</div>
				<div className="w-[40ch] text-a8c-gray-70 a8c-body pr-2">
					{ __(
						'Connect an existing WordPress.com site, or create a new one and share your site with the world.'
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Push and pull changes from your live site.' ),
						__( 'Supports staging and production sites.' ),
						__( 'Sync database and file changes.' ),
					].map( ( text ) => (
						<div key={ text } className="text-a8c-gray-70 a8c-body flex items-center">
							<Icon className="fill-a8c-blueberry mr-2 shrink-0" icon={ check } /> { text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<div className="flex flex-col shrink-0 items-end p-4">
				<SyncTabImage />
			</div>
		</div>
	);
}

export function ContentTabSync( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();

	return (
		<div className="flex flex-col gap-4">
			<SiteSyncDesription selectedSite={ selectedSite } />
		</div>
	);
}
