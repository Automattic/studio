import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Icon, published } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState, useRef } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { UPDATED_MESSAGE_DURATION_MS } from 'src/constants';
import { useExpirationDate } from 'src/hooks/use-expiration-date';
import { useFormatLocalizedTimestamps } from 'src/hooks/use-format-localized-timestamps';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { useUpdateDemoSite } from 'src/hooks/use-update-demo-site';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { PreviewActionButtonsMenu } from './preview-action-buttons-menu';
import { ProgressRow } from './progress-row';

interface PreviewSiteRowProps {
	snapshot: Snapshot;
	selectedSite: SiteDetails;
}

export function PreviewSiteRow( { snapshot, selectedSite }: PreviewSiteRowProps ) {
	const { __ } = useI18n();
	const { url, date, isDeleting } = snapshot;
	const { countDown } = useExpirationDate( date );
	const { fetchSnapshotUsage } = useSnapshots();
	const { isDemoSiteUpdating } = useUpdateDemoSite();
	const isPreviewSiteUpdating = isDemoSiteUpdating( snapshot.atomicSiteId );
	const { formatRelativeTime } = useFormatLocalizedTimestamps();
	const [ showUpdatedMessage, setShowUpdatedMessage ] = useState( false );
	const wasUpdating = useRef( false );

	useEffect( () => {
		if ( isPreviewSiteUpdating ) {
			wasUpdating.current = true;
			setShowUpdatedMessage( false );
			return;
		}

		if ( ! wasUpdating.current ) {
			return;
		}
		wasUpdating.current = false;
		setShowUpdatedMessage( true );

		const timeoutId = setTimeout( () => {
			setShowUpdatedMessage( false );
		}, UPDATED_MESSAGE_DURATION_MS );

		return () => clearTimeout( timeoutId );
	}, [ isPreviewSiteUpdating ] );

	const getLastUpdateTimeText = () => {
		if ( ! date ) {
			return '-';
		}

		if ( showUpdatedMessage ) {
			return (
				<div className="flex items-center">
					<Icon icon={ published } className="!mt-0 mr-1 fill-a8c-green-50" />
					<span className="text-a8c-green-50">{ __( 'Updated' ) }</span>
				</div>
			);
		}

		const timeDistance = formatRelativeTime( new Date( date ).toISOString() );
		return sprintf( __( '%s ago' ), timeDistance );
	};

	useEffect( () => {
		fetchSnapshotUsage();
	}, [ fetchSnapshotUsage ] );

	const urlWithHTTPS = `https://${ url }`;

	if ( isDeleting ) {
		return <ProgressRow text={ __( 'Deleting preview site' ) } />;
	}

	return (
		<div className="self-stretch flex-col">
			<div className="flex items-center px-8 py-6">
				<div className="w-[51%]">
					<div className="flex items-center">
						<div className="text-[13px] leading-5 line-clamp-1 break-all">
							{ selectedSite.name }
						</div>
					</div>
					<Button
						variant="link"
						className="!text-a8c-gray-70 hover:!text-a8c-blueberry max-w-[100%]"
						onClick={ () => {
							getIpcApi().openURL( urlWithHTTPS );
						} }
					>
						<span className="truncate">{ urlWithHTTPS }</span>
						<ArrowIcon />
					</Button>
				</div>
				<div className="flex ml-auto">
					<div className="w-[110px] text-[#757575] flex items-center pl-4">
						{ isPreviewSiteUpdating ? (
							<div className="flex items-center text-gray-900">
								<Spinner className="!mt-0 !mx-2" />
								{ __( 'Updating' ) }
							</div>
						) : (
							getLastUpdateTimeText()
						) }
					</div>
					<div className="w-[100px] text-[#757575] flex items-center pl-4">{ countDown }</div>
					<div className="w-[60px] flex justify-end">
						<PreviewActionButtonsMenu snapshot={ snapshot } selectedSite={ selectedSite } />
					</div>
				</div>
			</div>
		</div>
	);
}
