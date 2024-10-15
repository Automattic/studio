// Create a modal using @wordpress/components to list all the sites that are connected to the user's WordPress.com account.

import { SearchControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { cx } from '../lib/cx';
import { Badge } from './badge';
import Button from './button';
import Modal from './modal';
import { WordPressShortLogo } from './wordpress-short-logo';

export function SitesSyncSelector( { onRequestClose }: { onRequestClose: () => void } ) {
	const { __ } = useI18n();
	return (
		<Modal
			className="w-3/5 h-full max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ __( 'Connect a WordPress.com site' ) }
		>
			<SearchSites />
			<ListSites />
			<Footer />
		</Modal>
	);
}

function SearchSites() {
	const { __ } = useI18n();
	return (
		<div className="flex flex-col px-8 pb-6 border-b border-a8c-gray-5">
			<SearchControl
				className="w-full"
				placeholder={ __( 'Search sites' ) }
				onChange={ ( value ) => {
					console.log( value );
				} }
			/>
			<p className="a8c-helper-text text-gray-500">
				{ __( 'Syncing is supported for sites on the Business plan or above.' ) }
			</p>
		</div>
	);
}

function ListSites() {
	return (
		<div className="flex flex-col gap-4 overflow-y-auto h-[calc(84vh-230px)]">
			<SiteItem
				site={ {
					name: 'Example Site',
					url: 'https://example.com',
					supportedPlan: false,
					hasStaging: true,
				} }
			/>
			{ Array.from( { length: 10 } ).map( ( _, index ) => (
				<SiteItem
					key={ index }
					site={ {
						name: `Example Site ${ index }`,
						url: `https://example.com/${ index }`,
						supportedPlan: true,
						hasStaging: true,
					} }
				/>
			) ) }
		</div>
	);
}

function SiteItem( {
	site,
}: {
	site: {
		name: string;
		url: string;
		supportedPlan: boolean;
		hasStaging: boolean;
	};
} ) {
	const { __ } = useI18n();
	return (
		<div className="flex py-3 px-8 items-center border-b border-a8c-gray-0 justify-between">
			<div className="flex flex-col gap-0.5">
				<div className={ cx( 'a8c-body', ! site.supportedPlan && 'text-a8c-gray-30' ) }>
					{ site.name }
				</div>
				<div className="a8c-body-small text-a8c-gray-30">{ site.url }</div>
			</div>
			{ site.supportedPlan && (
				<div className="flex gap-2">
					<Badge className="bg-a8c-green-5 text-a8c-green-80"> { __( 'Production' ) }</Badge>
					{ site.hasStaging && <Badge> { __( 'Staging' ) }</Badge> }
				</div>
			) }
			{ ! site.supportedPlan && (
				<div className="a8c-body-small text-a8c-gray-30"> { __( 'Unsupported plan' ) }</div>
			) }
		</div>
	);
}

function Footer() {
	const { __ } = useI18n();
	return (
		<div className="flex px-8 py-4 border-t border-a8c-gray-5 justify-between">
			<div className="flex items-center mb-1">
				<div className="a8c-subtitle">{ __( 'Powered by' ) }</div>
				<WordPressShortLogo className="ml-2 h-5" />
			</div>
			<div className="flex gap-4">
				<Button variant="link">{ __( 'Cancel' ) }</Button>
				<Button variant="primary">{ __( 'Connect' ) }</Button>
			</div>
		</div>
	);
}
