import { Spinner } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { Icon, published, warning } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState, useRef } from 'react';
import { Snapshot } from 'common/types/snapshot';
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
import { snapshotActions, snapshotSelectors } from 'src/stores/snapshot-slice';

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
	const isPreviewSiteUpdating = updateOperation?.status === 'pending';
	const hasError = updateOperation?.status === 'rejected';
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

		if ( ! hasError ) {
			setShowUpdatedMessage( true );
		}

		const timeoutId = setTimeout( () => {
			setShowUpdatedMessage( false );
		}, UPDATED_MESSAGE_DURATION_MS );

		return () => clearTimeout( timeoutId );
	}, [ hasError, isPreviewSiteUpdating ] );

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

		if ( hasError ) {
			return (
				<div className="flex items-center">
					<Icon icon={ warning } className="!mt-0 mr-1 fill-a8c-red-50" />
					<span className="text-a8c-red-50">{ __( 'Failed' ) }</span>
				</div>
			);
		}

		const timeDistance = formatRelativeTime( new Date( date ).toISOString() );
		return sprintf( __( '%s ago' ), timeDistance );
	};

	const urlWithHTTPS = `https://${ url }`;

	if ( deleteOperation ) {
		return <DeleteProgressRow />;
	}

	return (
		<div className="self-stretch flex-col">
			<div className="flex items-center px-8 py-6">
				<div className="w-[51%] overflow-hidden pe-4">
					<div className="flex items-center">
						<div
							className={ cx(
								'text-[13px] leading-5 line-clamp-1 break-all',
								isExpired && 'line-through text-a8c-gray-700'
							) }
						>
							{ /* translators: %s: Site name (e.g. "My Site Preview") */ }
							{ snapshot.name || sprintf( __( '%s Preview' ), selectedSite.name ) }
						</div>
					</div>
					<Button
						variant="link"
						disabled={ isExpired }
						className={ cx(
							'!text-a8c-gray-700 max-w-full',
							isExpired ? 'pointer-events-none' : 'hover:!text-a8c-blueberry'
						) }
						onClick={ () => getIpcApi().openURL( urlWithHTTPS ) }
					>
						<span className={ cx( 'truncate', isExpired && 'line-through text-a8c-gray-700' ) }>
							{ urlWithHTTPS }
						</span>
						{ ! isExpired && <ArrowIcon /> }
					</Button>
				</div>
				<div className="flex ltr:ml-auto rtl:mr-auto">
					<div className="w-[150px] text-a8c-gray-700 flex items-center pl-4">
						{ isPreviewSiteUpdating ? (
							<div className="flex items-center text-gray-900">
								<Spinner className="!mt-0 !mx-2" />
								{ __( 'Updating' ) }
							</div>
						) : (
							<Tooltip text={ dateString } disabled={ ! date }>
								{ getLastUpdateTimeText() }
							</Tooltip>
						) }
					</div>
					<div className="flex items-center">
						<Tooltip text={ expireDateString } disabled={ isExpired }>
							<div className="w-[150px] text-a8c-gray-700 pl-4">{ countDown }</div>
						</Tooltip>
					</div>
					<div className="w-[60px] flex justify-end">
						{ isExpired ? (
							<Button
								variant="link"
								onClick={ () => {
									dispatch(
										snapshotActions.deleteSnapshotLocally( {
											atomicSiteId: snapshot.atomicSiteId,
										} )
									);
								} }
								className={ '!text-a8c-blueberry hover:!text-a8c-red-50' }
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
