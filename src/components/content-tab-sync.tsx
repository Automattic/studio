import { Icon } from '@wordpress/components';
import { check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import Button from './button';
import { ScreenshotDemoSite } from './screenshot-demo-site';

function SiteSyncDesription( {
	children,
	selectedSite,
}: PropsWithChildren< { selectedSite: SiteDetails } > ) {
	const { __ } = useI18n();
	return (
		<div className="p-8 flex justify-between max-w-3xl gap-4">
			<div className="flex flex-col">
				<div className="a8c-subtitle mb-1">{ __( 'Sync with' ) }</div>
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
			<div className="flex flex-col shrink-0 items-end">
				<ScreenshotDemoSite site={ selectedSite } />
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
