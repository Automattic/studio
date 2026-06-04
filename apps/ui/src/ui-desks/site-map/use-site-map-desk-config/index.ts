import {
	store as coreDataStore,
	useEntityRecords,
	type Post as CoreDataPost,
} from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { useSites } from '@/data/queries/use-sites';
import { BLOG_WIDGET_TYPE } from '@/ui-desks/widgets/blog/types';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import {
	createSiteMapDeskConfig,
	emptySiteMapDeskConfig,
	getSiteMapDeskConfigSignature,
	type SiteMapPage,
	type SiteMapSettings,
} from '../desk-config';

type CoreDataPage = CoreDataPost & {
	parent?: number;
	menu_order?: number;
	slug?: string;
};

type CoreDataBase = SiteMapSettings;
type CoreDataResolutionStatus = 'IDLE' | 'RESOLVING' | 'SUCCESS' | 'ERROR';
type CoreDataResolutionState =
	| {
			status: 'resolving' | 'finished';
	  }
	| {
			status: 'error';
			error: Error | unknown;
	  };

const SITE_MAP_PAGE_QUERY = {
	per_page: 100,
	context: 'view',
	orderby: 'menu_order',
	order: 'asc',
	_fields: 'id,parent,menu_order,title,slug,status',
} as const;
const ROOT_INDEX_ENTITY_ARGS: [ string, string ] = [ 'root', '__unstableBase' ];

export function useSiteMapDeskConfig( siteId: string | undefined, enabled: boolean ) {
	const { data: sites, isLoading: isLoadingSites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const canQueryPages = Boolean( enabled && site?.running );
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< CoreDataPage >( 'postType', 'page', SITE_MAP_PAGE_QUERY, {
		enabled: canQueryPages,
	} );
	const { settings, isResolvingSettings, settingsStatus } = useRootIndexSettings( canQueryPages );
	const pages = useMemo( () => ( records ?? [] ).map( recordToSiteMapPage ), [ records ] );
	const signature = useMemo(
		() => getSiteMapDeskConfigSignature( pages, settings ),
		[ pages, settings ]
	);
	const config = useMemo( () => createSiteMapDeskConfig( pages, settings ), [ pages, settings ] );
	const pageCount = useMemo( () => getVisiblePageCount( config ), [ config ] );
	const isLoading = Boolean(
		enabled &&
			( isLoadingSites ||
				( canQueryPages &&
					( ( isResolving && ! records ) || ( isResolvingSettings && ! settings ) ) ) )
	);
	const message = getSiteMapMessage( {
		enabled,
		hasContent: config.widgets.length > 0,
		hasSite: Boolean( site ),
		isLoading,
		pageCount: pages.length,
		resolutionStatus,
		settingsStatus,
		siteIsRunning: Boolean( site?.running ),
	} );

	return {
		config: enabled ? config : emptySiteMapDeskConfig,
		isLoading,
		message,
		pageCount,
		pages,
		signature,
	};
}

function getVisiblePageCount( config: ReturnType< typeof createSiteMapDeskConfig > ) {
	return config.widgets.filter(
		( widget ) => widget.type === PAGE_WIDGET_TYPE || widget.type === BLOG_WIDGET_TYPE
	).length;
}

function useRootIndexSettings( enabled: boolean ) {
	return useSelect(
		( select ) => {
			if ( ! enabled ) {
				return {
					settings: undefined,
					isResolvingSettings: false,
					settingsStatus: 'IDLE' as CoreDataResolutionStatus,
				};
			}

			const coreData = select( coreDataStore );
			const settings = coreData.getEntityRecord( ...ROOT_INDEX_ENTITY_ARGS ) as
				| CoreDataBase
				| undefined;
			const resolutionState = coreData.getResolutionState(
				'getEntityRecord',
				ROOT_INDEX_ENTITY_ARGS
			) as CoreDataResolutionState | undefined;
			const settingsStatus = getCoreDataResolutionStatus( resolutionState?.status );

			return {
				settings,
				isResolvingSettings:
					! settings && ( settingsStatus === 'IDLE' || settingsStatus === 'RESOLVING' ),
				settingsStatus,
			};
		},
		[ enabled ]
	);
}

function getCoreDataResolutionStatus(
	status: CoreDataResolutionState[ 'status' ] | undefined
): CoreDataResolutionStatus {
	if ( status === 'resolving' ) {
		return 'RESOLVING';
	}

	if ( status === 'finished' ) {
		return 'SUCCESS';
	}

	if ( status === 'error' ) {
		return 'ERROR';
	}

	return 'IDLE';
}

function recordToSiteMapPage( record: CoreDataPage ): SiteMapPage {
	return {
		id: record.id,
		parent: record.parent ?? 0,
		menu_order: record.menu_order ?? 0,
		slug: record.slug,
		title: record.title,
	};
}

function getSiteMapMessage( {
	enabled,
	hasContent,
	hasSite,
	isLoading,
	pageCount,
	resolutionStatus,
	settingsStatus,
	siteIsRunning,
}: {
	enabled: boolean;
	hasContent: boolean;
	hasSite: boolean;
	isLoading: boolean;
	pageCount: number;
	resolutionStatus: string;
	settingsStatus: string;
	siteIsRunning: boolean;
} ) {
	if ( ! enabled || isLoading ) {
		return undefined;
	}

	if ( ! hasSite ) {
		return __( 'Site not found.' );
	}

	if ( ! siteIsRunning ) {
		return __( 'Start the site to view its site map.' );
	}

	if ( resolutionStatus === 'ERROR' || settingsStatus === 'ERROR' ) {
		return __( 'Unable to load site map.' );
	}

	if ( pageCount === 0 && ! hasContent ) {
		return __( 'No pages found.' );
	}

	return undefined;
}
