import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';

const LINES_PER_PAGE = 200;

interface ContentTabDebugLogProps {
	selectedSite: SiteDetails;
}

export function ContentTabDebugLog( { selectedSite }: ContentTabDebugLogProps ) {
	const [ lines, setLines ] = useState< string[] >( [] );
	const [ totalLines, setTotalLines ] = useState( 0 );
	const [ offset, setOffset ] = useState( 0 );
	const [ loading, setLoading ] = useState( true );
	const [ loadingMore, setLoadingMore ] = useState( false );
	const [ isEmpty, setIsEmpty ] = useState( false );
	const containerRef = useRef< HTMLDivElement >( null );
	const isAtBottomRef = useRef( true );
	const siteId = selectedSite.id;

	const loadLatest = useCallback( async () => {
		const result = await getIpcApi().readSiteDebugLog( siteId, { limit: LINES_PER_PAGE } );
		if ( ! result ) {
			setIsEmpty( true );
			setLines( [] );
			setTotalLines( 0 );
			setOffset( 0 );
		} else {
			setIsEmpty( result.totalLines === 0 );
			setLines( result.lines );
			setTotalLines( result.totalLines );
			setOffset( Math.max( 0, result.totalLines - LINES_PER_PAGE ) );
		}
		setLoading( false );
	}, [ siteId ] );

	// Initial load
	useEffect( () => {
		setLoading( true );
		void loadLatest();
	}, [ loadLatest ] );

	// File watching
	useEffect( () => {
		getIpcApi().watchDebugLog( siteId );
		return () => {
			getIpcApi().unwatchDebugLog( siteId );
		};
	}, [ siteId ] );

	// Auto-refresh on file change
	const handleDebugLogUpdate = useCallback(
		( _event: unknown, data: { siteId: string } ) => {
			if ( data.siteId === siteId ) {
				void loadLatest();
			}
		},
		[ siteId, loadLatest ]
	);
	useIpcListener( 'debug-log-updated', handleDebugLogUpdate );

	// Auto-scroll to bottom when new content arrives (if already at bottom)
	useEffect( () => {
		if ( isAtBottomRef.current && containerRef.current ) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [ lines ] );

	const handleScroll = useCallback( async () => {
		const container = containerRef.current;
		if ( ! container ) {
			return;
		}

		// Track if user is at the bottom
		const distanceFromBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight;
		isAtBottomRef.current = distanceFromBottom < 50;

		// Load more when scrolled to top
		if ( container.scrollTop === 0 && offset > 0 && ! loadingMore ) {
			setLoadingMore( true );
			const previousScrollHeight = container.scrollHeight;
			const newOffset = Math.max( 0, offset - LINES_PER_PAGE );
			const limit = offset - newOffset;
			const result = await getIpcApi().readSiteDebugLog( siteId, {
				offset: newOffset,
				limit,
			} );
			if ( result ) {
				setLines( ( prev ) => [ ...result.lines, ...prev ] );
				setTotalLines( result.totalLines );
				setOffset( newOffset );
				// Restore scroll position after prepending
				requestAnimationFrame( () => {
					container.scrollTop = container.scrollHeight - previousScrollHeight;
				} );
			}
			setLoadingMore( false );
		}
	}, [ offset, loadingMore, siteId ] );

	if ( loading ) {
		return (
			<div className="p-8 flex items-center justify-center h-full">
				<p className="text-a8c-gray-50">{ __( 'Loading debug log…' ) }</p>
			</div>
		);
	}

	if ( isEmpty ) {
		return (
			<div className="p-8 flex items-center justify-center h-full">
				<p className="text-a8c-gray-50">
					{ __( 'No debug log entries yet. PHP errors and warnings will appear here.' ) }
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full px-8 pb-4">
			<div
				ref={ containerRef }
				onScroll={ handleScroll }
				className="flex-1 overflow-y-auto bg-[#1e1e1e] p-4"
				style={ { scrollbarWidth: 'thin' } }
			>
				{ loadingMore && (
					<div className="text-center text-a8c-gray-50 py-2 text-xs">{ __( 'Loading more…' ) }</div>
				) }
				{ offset > 0 && ! loadingMore && (
					<div className="text-center text-gray-500 py-2 text-xs">
						{ __( 'Scroll up to load more' ) }
					</div>
				) }
				<pre className="font-mono text-xs text-gray-200 whitespace-pre-wrap break-words m-0">
					{ lines.join( '\n' ) }
				</pre>
			</div>
			<div className="flex items-center justify-between px-4 py-2 border-t border-a8c-gray-5 text-xs text-a8c-gray-50">
				<span>
					{ totalLines } { __( 'lines' ) }
				</span>
			</div>
		</div>
	);
}
