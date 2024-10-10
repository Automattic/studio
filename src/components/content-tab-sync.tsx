import { Icon } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
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
				<div className="a8c-subtitle mb-1">{ __( 'Share a demo site' ) }</div>
				<div className="w-[40ch] text-a8c-gray-70 a8c-body pr-2">
					{ createInterpolateElement(
						__(
							'Get feedback from anyone, anywhere with a free demo site powered by <a>WordPress.com</a>.'
						),
						{
							a: (
								<Button
									variant="link"
									onClick={ () =>
										getIpcApi().openURL(
											'https://wordpress.com/?utm_source=studio&utm_medium=referral&utm_campaign=demo_sites_onboarding'
										)
									}
								/>
							),
						}
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Share a hosted clone of your local site.' ),
						__( 'Push updates to your demo site at any time.' ),
						__( 'Demo sites are deleted 7 days after the last update.' ),
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
