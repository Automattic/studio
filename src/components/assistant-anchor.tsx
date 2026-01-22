import { speak } from '@wordpress/a11y';
import { __ } from '@wordpress/i18n';
import { ExtraProps } from 'react-markdown';
import { TELEX_HOSTNAME, TELEX_UTM_PARAMS } from 'src/constants';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { addUrlParams, getHostnameFromUrl } from 'src/lib/url-utils';

export default function Anchor( props: JSX.IntrinsicElements[ 'a' ] & ExtraProps ) {
	const { href } = props;
	const { node, className, ...filteredProps } = props;
	const { selectedSite, startServer, loadingServer } = useSiteDetails();

	return (
		<a
			{ ...filteredProps }
			className={ cx(
				className,
				selectedSite && loadingServer[ selectedSite.id ] && 'animate-pulse duration-100 cursor-wait'
			) }
			onClick={ async ( e ) => {
				if ( ! href ) {
					return;
				}

				e.preventDefault();

				const urlForStoppedSite =
					/^https?:\/\/localhost/.test( href ) && selectedSite && ! selectedSite.running;
				if ( urlForStoppedSite ) {
					speak( __( 'Starting the server before opening the site link' ) );
					await startServer( selectedSite?.id );
				}

				const isTelexUrl = getHostnameFromUrl( href ) === TELEX_HOSTNAME;
				const finalUrl = isTelexUrl ? addUrlParams( href, TELEX_UTM_PARAMS ) : href;
				getIpcApi().openURL( finalUrl );
			} }
		/>
	);
}
