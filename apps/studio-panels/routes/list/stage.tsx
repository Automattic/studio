import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { DataViews, type View, type Field } from '@wordpress/dataviews';
import { useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import type { ListLoaderData } from './route';

interface RestPost {
	id: number;
	link: string;
	date_gmt: string;
	status: string;
	type: string;
	title: { rendered: string };
	author?: number;
}

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

interface StageProps {
	loaderData: ListLoaderData;
}

// Wrap in an uppercase component because `useSelect` / `useMemo` / `useState`
// must live inside a React component or hook. wp-build looks for an export
// named `stage` to mount the route, so we re-export below.
function ListStage( { loaderData }: StageProps ) {
	const { postType, columns, perPage, search: initialSearch } = loaderData;

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

export const stage = ( props: StageProps ) => <ListStage { ...props } />;
