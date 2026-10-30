import { useStartSite } from '@/data/queries/use-sites';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import { useMediaQuery } from '@/lib/hooks';

/** Explicit Play controls reveal the preview without changing its chosen layout. */
export function useStartSitePreview() {
	const start = useStartSite();
	const preview = useOptionalSessionPreviewUI();
	const narrow = useMediaQuery( '(max-width: 540px)' );
	const reveal = ( siteId: string ) => {
		preview?.setOpen( true );
		if ( narrow ) preview?.setChatHidden( true, siteId );
	};
	return {
		...start,
		mutate: ( ...args: Parameters< typeof start.mutate > ) => {
			reveal( args[ 0 ] );
			start.mutate( ...args );
		},
		mutateAsync: ( ...args: Parameters< typeof start.mutateAsync > ) => {
			reveal( args[ 0 ] );
			return start.mutateAsync( ...args );
		},
	};
}
