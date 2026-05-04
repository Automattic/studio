import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { DataViews, type View, type Field } from '@wordpress/dataviews';
import { useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { useSearch } from '@wordpress/route';

interface RestPost {
	id: number;
	link: string;
	date_gmt: string;
	status: string;
	type: string;
	title: { rendered: string };
	author?: number;
}

const DEFAULT_COLUMNS = [ 'title', 'date', 'status' ];
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

const ALL_FIELDS: Record< string, Field< RestPost > > = {
	title: {
		id: 'title',
		label: __( 'Title' ),
		render: ( { item } ) => (
			<span dangerouslySetInnerHTML={ { __html: item.title?.rendered || `(#${ item.id })` } } />
		),
		enableSorting: false,
	},
	date: {
		id: 'date',
		label: __( 'Date' ),
		render: ( { item } ) =>
			item.date_gmt ? new Date( item.date_gmt + 'Z' ).toLocaleString() : '',
		enableSorting: false,
	},
	status: {
		id: 'status',
		label: __( 'Status' ),
		render: ( { item } ) => item.status,
		enableSorting: false,
	},
	id: {
		id: 'id',
		label: __( 'ID' ),
		render: ( { item } ) => String( item.id ),
		enableSorting: false,
	},
	type: {
		id: 'type',
		label: __( 'Type' ),
		render: ( { item } ) => item.type,
		enableSorting: false,
	},
	author: {
		id: 'author',
		label: __( 'Author' ),
		render: ( { item } ) => ( item.author !== undefined ? String( item.author ) : '' ),
		enableSorting: false,
	},
};

interface ListSearchParams {
	postType?: string;
	columns?: string;
	perPage?: string;
	search?: string;
}

function parseColumns( raw: string | undefined ): string[] {
	if ( ! raw ) return DEFAULT_COLUMNS;
	const list = raw
		.split( ',' )
		.map( ( c ) => c.trim() )
		.filter( ( c ) => c.length > 0 );
	return list.length > 0 ? list : DEFAULT_COLUMNS;
}

function clampPerPage( raw: string | undefined ): number {
	if ( ! raw ) return DEFAULT_PER_PAGE;
	const n = Number( raw );
	if ( ! Number.isFinite( n ) || n < 1 ) return DEFAULT_PER_PAGE;
	return Math.min( Math.floor( n ), MAX_PER_PAGE );
}

// Wrap in an uppercase component because `useSelect` / `useMemo` / `useState`
// must live inside a React component or hook. wp-build looks for an export
// named `stage` to mount the route, so we re-export below.
function ListStage() {
	const search = useSearch( { strict: false } ) as ListSearchParams;
	const postType = ( search.postType || 'post' ).trim();
	const columns = useMemo( () => parseColumns( search.columns ), [ search.columns ] );
	const perPage = clampPerPage( search.perPage );
	const initialSearch = search.search ?? '';

	const fields = useMemo< Field< RestPost >[] >(
		() => columns.map( ( id ) => ALL_FIELDS[ id ] ).filter( Boolean ),
		[ columns ]
	);

	const [ view, setView ] = useState< View >( () => ( {
		type: 'table',
		fields: columns,
		page: 1,
		perPage,
		search: initialSearch,
	} ) );

	const query = useMemo(
		() => ( {
			per_page: view.perPage,
			page: view.page,
			search: view.search || undefined,
			context: 'edit' as const,
			_fields: 'id,link,date_gmt,status,type,title,author',
		} ),
		[ view.perPage, view.page, view.search ]
	);

	const { posts, isLoading, totalItems, totalPages } = useSelect(
		( select ) => {
			const store = select( coreStore );
			const records = store.getEntityRecords( 'postType', postType, query ) as RestPost[] | null;
			const total = store.getEntityRecordsTotalItems( 'postType', postType, query );
			const pages = store.getEntityRecordsTotalPages( 'postType', postType, query );
			return {
				posts: records ?? [],
				isLoading: records === null,
				totalItems: total ?? 0,
				totalPages: pages ?? 1,
			};
		},
		[ postType, query ]
	);

	const paginationInfo = useMemo(
		() => ( { totalItems, totalPages } ),
		[ totalItems, totalPages ]
	);

	return (
		<div style={ { padding: '24px' } }>
			<h1 style={ { marginBottom: '16px' } }>
				{
					/* translators: %s is a post type slug. */
					sprintf( __( '%s list' ), postType )
				}
			</h1>
			<DataViews
				data={ posts }
				fields={ fields }
				view={ view }
				onChangeView={ setView }
				paginationInfo={ paginationInfo }
				isLoading={ isLoading }
				defaultLayouts={ { table: {} } }
				getItemId={ ( item ) => String( item.id ) }
			/>
		</div>
	);
}

export const stage = () => <ListStage />;
