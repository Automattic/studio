import { Notice } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { ActionButton } from 'src/components/action-button';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useVipContext } from './vip-context';

export function VipHeader() {
	const { __ } = useI18n();
	const {
		selectedEnvironment,
		loadingEnvironments,
		startEnvironment,
		stopEnvironment,
		operationError,
		clearOperationError,
	} = useVipContext();

	if ( ! selectedEnvironment ) {
		return null;
	}

	const isLoading = loadingEnvironments[ selectedEnvironment.slug ] ?? false;

	const handleWpAdminClick = async () => {
		if ( isLoading ) return;
		if ( ! selectedEnvironment.running ) {
			await startEnvironment( selectedEnvironment.slug );
		}
		if ( selectedEnvironment.urls.length > 0 ) {
			const adminUrl = selectedEnvironment.autologinKey
				? `${ selectedEnvironment.urls[ 0 ] }wp-login.php?vip-autologin=${ selectedEnvironment.autologinKey }`
				: `${ selectedEnvironment.urls[ 0 ] }wp-admin/`;
			getIpcApi().openURL( adminUrl );
		}
	};

	const handleOpenSiteClick = async () => {
		if ( isLoading ) return;
		if ( ! selectedEnvironment.running ) {
			await startEnvironment( selectedEnvironment.slug );
		}
		if ( selectedEnvironment.urls.length > 0 ) {
			getIpcApi().openURL( selectedEnvironment.urls[ 0 ] );
		}
	};

	return (
		<div className="flex flex-col w-full gap-2">
			{ operationError && (
				<div className="px-8">
					<Notice status="error" isDismissible={ true } onRemove={ clearOperationError }>
						{ operationError }
					</Notice>
				</div>
			) }
			<div
				data-testid="vip-content-header"
				className="flex justify-between items-start w-full gap-5 px-8"
			>
				<div className="flex flex-col">
					<h1 className="text-xl font-medium max-h-full line-clamp-1 break-all">
						{ selectedEnvironment.title || selectedEnvironment.slug }
					</h1>
					<div className="flex mt-1 gap-x-4">
						<Button
							className="[&.is-link]:text-a8c-gray-70 [&.is-link]:hover:text-a8c-blue-50 !px-0 h-0 leading-4"
							onClick={ () => {
								void handleWpAdminClick();
							} }
							variant="link"
							disabled={ isLoading }
						>
							{ __( 'WP admin' ) }
							<ArrowIcon />
						</Button>
						<Button
							className="[&.is-link]:text-a8c-gray-70 [&.is-link]:hover:text-a8c-blue-50 !px-0 h-0 leading-4"
							onClick={ () => {
								void handleOpenSiteClick();
							} }
							variant="link"
							disabled={ isLoading }
						>
							{ __( 'Open site' ) }
							<ArrowIcon />
						</Button>
					</div>
				</div>
				<div className="flex gap-2">
					<ActionButton
						isRunning={ selectedEnvironment.running }
						isLoading={ isLoading }
						onClick={ () => {
							if ( selectedEnvironment.running ) {
								void stopEnvironment( selectedEnvironment.slug );
							} else {
								void startEnvironment( selectedEnvironment.slug );
							}
						} }
						disabled={ false }
						buttonLabelOnDisabled=""
					/>
				</div>
			</div>
		</div>
	);
}
