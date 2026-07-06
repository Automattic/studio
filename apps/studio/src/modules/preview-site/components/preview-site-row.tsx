import { Snapshot } from '@studio/common/types/snapshot';
import { Spinner } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { Icon, published, cautionFilled } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState, useRef } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { TooltipProps, Tooltip } from 'src/components/tooltip';
import { UPDATED_MESSAGE_DURATION_MS } from 'src/constants';
import { useExpirationDate } from 'src/hooks/use-expiration-date';
import { useFormatLocalizedTimestamps } from 'src/hooks/use-format-localized-timestamps';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { DeleteProgressRow } from 'src/modules/preview-site/components/delete-progress-row';
import { PreviewActionButtonsMenu } from 'src/modules/preview-site/components/preview-action-buttons-menu';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { snapshotSelectors, snapshotThunks } from 'src/stores/snapshot-slice';
import { useGetSnapshotStatus } from 'src/stores/wpcom-api';

interface PreviewSiteRowProps {
	snapshot: Snapshot;
	selectedSite: SiteDetails;
	disabledUpdate: boolean;
	updateButtonTooltipContent?: Partial< TooltipProps & { text?: string } >;
	showUpdateTooltip?: boolean;
}

export function PreviewSiteRow( {
	snapshot,
	selectedSite,
	disabledUpdate,
	updateButtonTooltipContent = {},
	showUpdateTooltip = false,
}: PreviewSiteRowProps ) {
	const { __ } = useI18n();
	const { url, date } = snapshot;
	const { countDown, dateString, expireDateString, isExpired } = useExpirationDate( date );
	const dispatch = useAppDispatch();
	const updateOperation = useRootSelector( ( state ) =>
		snapshotSelectors.selectUpdateOperationForSnapshot( state, snapshot.atomicSiteId )
	);
	const deleteOperation = useRootSelector( ( state ) =>
		snapshotSelectors.selectDeleteOperationForSnapshot( state, snapshot.url )
	);
	const { data: snapshotStatus } = useGetSnapshotStatus( snapshot.atomicSiteId, {
		refetchOnMountOrArgChange: true,
	} );
	const { formatRelativeTime } = useFormatLocalizedTimestamps();
	const [ showUpdatedMessage, setShowUpdatedMessage ] = useState( false );
	const wasUpdating = useRef( false );
	const isDeleted = snapshotStatus?.isDeleted;
	const isSiteInactive = isExpired || isDeleted;

	useEffect( () => {
		if ( ! updateOperation ) {
			return;
		}

		if ( updateOperation.status === 'pending' ) {
			wasUpdating.current = true;
			setShowUpdatedMessage( false );
			return;
		}

		if ( ! wasUpdating.current ) {
			return;
		}
		wasUpdating.current = false;

		if ( updateOperation.status === 'fulfilled' ) {
			setShowUpdatedMessage( true );
		}

		const timeoutId = setTimeout( () => {
			setShowUpdatedMessage( false );
		}, UPDATED_MESSAGE_DURATION_MS );

		return () => clearTimeout( timeoutId );
	}, [ updateOperation ] );

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

		if ( updateOperation?.status === 'rejected' ) {
			return (
				<div className="flex items-center">
					<Icon icon={ cautionFilled } className="!mt-0 mr-1 fill-a8c-red-50" />
					{ /* translators: status label shown in the preview sites list when the last update operation failed */ }
					<span className="text-a8c-red-50">{ __( 'Failed' ) }</span>
				</div>
			);
		}

		const timeDistance = formatRelativeTime( new Date( date ).toISOString() );
		return sprintf( __( '%s ago' ), timeDistance );
	};

	if ( deleteOperation?.status === 'pending' ) {
		return <DeleteProgressRow />;
	}

	return (
		<div className="self-stretch flex-col">
			<div className="flex items-center px-8 py-6">
				<div className="overflow-hidden pe-4">
					<Tooltip
						placement="top-start"
						text={ __(
							'This preview site has been deleted from the server. You can remove it from the list by clicking Clear button.'
						) }
						disabled={ isExpired || ! isDeleted }
					>
						<div className="flex flex-col">
							<div
								className={ cx(
									'text-[13px] leading-5 line-clamp-1 break-all',
									isExpired && 'line-through text-frame-text-secondary',
									! isExpired && isDeleted && 'line-through text-a8c-red-50'
								) }
							>
								{ /* translators: %s: Site name (e.g. "My Site Preview") */ }
								{ snapshot.name || sprintf( __( '%s Preview' ), selectedSite.name ) }
							</div>
							<Button
								variant="link"
								disabled={ isSiteInactive }
								className={ cx(
									'!text-frame-text-secondary max-w-full',
									isSiteInactive ? 'pointer-events-none' : 'hover:!text-frame-theme'
								) }
								onClick={ () => getIpcApi().openURL( `https://${ url }` ) }
							>
								<span
									className={ cx(
										'truncate',
										isSiteInactive && 'line-through text-frame-text-secondary'
									) }
								>
									{ url }
								</span>
								{ ! isSiteInactive && <ArrowIcon /> }
							</Button>
						</div>
					</Tooltip>
				</div>
				<div className="flex ltr:ml-auto rtl:mr-auto">
					<div className="w-[150px] text-frame-text-secondary flex items-center pl-4">
						{ updateOperation?.status === 'pending' ? (
							<div className="flex items-center text-frame-text">
								<Spinner className="!mt-0 !mx-2" />
								{ __( 'Updating' ) }
							</div>
						) : (
							<Tooltip text={ dateString } disabled={ ! date || isSiteInactive }>
								{ getLastUpdateTimeText() }
							</Tooltip>
						) }
					</div>
					<div className="flex items-center">
						<Tooltip text={ expireDateString } disabled={ isSiteInactive }>
							<div className="w-[150px] text-frame-text-secondary pl-4">
								{ isDeleted ? __( 'Deleted' ) : countDown }
							</div>
						</Tooltip>
					</div>
					<div className="w-[60px] flex justify-end">
						{ isSiteInactive ? (
							<Button
								variant="link"
								onClick={ () => {
									void dispatch(
										snapshotThunks.deleteSnapshot( {
											hostname: snapshot.url,
											optimistic: true,
										} )
									);
								} }
								className={ '!text-frame-theme hover:!text-a8c-red-50' }
							>
								{ __( 'Clear' ) }
							</Button>
						) : (
							<PreviewActionButtonsMenu
								snapshot={ snapshot }
								selectedSite={ selectedSite }
								disabledUpdate={ disabledUpdate }
								updateButtonTooltipContent={ updateButtonTooltipContent }
								showUpdateTooltip={ showUpdateTooltip }
							/>
						) }
					</div>
				</div>
			</div>
		</div>
	);
}
