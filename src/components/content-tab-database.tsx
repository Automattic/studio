import {
	Button,
	SearchControl,
	__experimentalInputControl as InputControl,
	Spinner,
	SelectControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	key,
	layout,
	Icon,
	update,
	chevronLeft,
	chevronRight,
	previous,
	next,
	chevronUp,
	chevronDown,
	keyboard,
} from '@wordpress/icons';
import { useEffect, useRef, useMemo, useReducer, useCallback } from 'react';
import EditRecordModal from 'src/components/database/edit-record-modal';
import { getIpcApi } from 'src/lib/get-ipc-api';

const WP_DATABASE_PATH = '/wp-content/database/.ht.sqlite';

// @TODO look at types in https://github.com/AzouKr/sqlite-gui-node/blob/main/src/Utils/databaseFunctions.ts

interface ContentTabDatabaseProps {
	selectedSite: SiteDetails;
}

interface Table {
	name: string;
}

interface TableColumn {
	name: string;
	type: string;
	pk: 0 | 1;
	dflt_value: string;
	notnull: 0 | 1;
}

type DatabaseValue = string | number | null;
type DatabaseRow = Record< string, DatabaseValue >;

interface SelectedItemState {
	table: Table | null;
	column: TableColumn | null;
	row: DatabaseRow | null;
}

interface CurrentTableState {
	tables: Table[];
	columns: TableColumn[] | null;
	rows: DatabaseRow[] | null;
	rowCount: number | null;
	filter: string;
	customQuery: string;
}

interface PaginationState {
	currentPage: number;
	rowsPerPage: number;
}

interface UIState {
	showEditRecordModal: boolean;
	showCustomQuery: boolean;
	isLoading: boolean;
	error: string | null;
}

interface SortState {
	column: string | null;
	direction: 'asc' | 'desc' | null;
}

interface DatabaseState {
	selected: SelectedItemState;
	current: CurrentTableState;
	pagination: PaginationState;
	ui: UIState;
	sort: SortState;
}

type DatabaseAction =
	| { type: 'SET_TABLES'; payload: Table[] }
	| { type: 'SET_SELECTED_TABLE'; payload: Table | null }
	| { type: 'SET_TABLE_COLUMNS'; payload: TableColumn[] | null }
	| { type: 'SET_TABLE_FILTER'; payload: string }
	| { type: 'SET_TABLE_ROWS'; payload: DatabaseRow[] | null }
	| { type: 'SET_ROW_COUNT'; payload: number | null }
	| { type: 'SET_SELECTED_ROW'; payload: DatabaseRow | null }
	| { type: 'SET_SELECTED_COLUMN'; payload: TableColumn | null }
	| { type: 'SET_CURRENT_PAGE'; payload: number }
	| { type: 'SET_ROWS_PER_PAGE'; payload: number }
	| { type: 'SET_SHOW_MODAL'; payload: boolean }
	| { type: 'SET_SHOW_CUSTOM_QUERY'; payload: boolean }
	| { type: 'SET_CUSTOM_QUERY'; payload: string }
	| { type: 'SET_LOADING'; payload: boolean }
	| { type: 'SET_ERROR'; payload: string | null }
	| { type: 'SET_SORT'; payload: { column: string | null; direction: 'asc' | 'desc' | null } }
	| { type: 'RESET_STATE' };

/*
 * @TODO refactor the state.
 */
const initialState: DatabaseState = {
	selected: {
		table: null,
		column: null,
		row: null,
	},
	current: {
		tables: [],
		columns: null,
		rows: null,
		rowCount: null,
		filter: '',
		customQuery: '',
	},
	pagination: {
		currentPage: 1,
		rowsPerPage: 20,
	},
	ui: {
		showEditRecordModal: false,
		showCustomQuery: false,
		isLoading: true,
		error: null,
	},
	sort: {
		column: null,
		direction: null,
	},
};

function databaseReducer( state: DatabaseState, action: DatabaseAction ): DatabaseState {
	switch ( action.type ) {
		case 'SET_TABLES':
			return { ...state, current: { ...state.current, tables: action.payload } };
		case 'SET_SELECTED_TABLE':
			return { ...state, selected: { ...state.selected, table: action.payload } };
		case 'SET_TABLE_COLUMNS':
			return { ...state, current: { ...state.current, columns: action.payload } };
		case 'SET_TABLE_FILTER':
			return { ...state, current: { ...state.current, filter: action.payload } };
		case 'SET_TABLE_ROWS':
			return { ...state, current: { ...state.current, rows: action.payload } };
		case 'SET_ROW_COUNT':
			return { ...state, current: { ...state.current, rowCount: action.payload } };
		case 'SET_SELECTED_ROW':
			return { ...state, selected: { ...state.selected, row: action.payload } };
		case 'SET_SELECTED_COLUMN':
			return { ...state, selected: { ...state.selected, column: action.payload } };
		case 'SET_CURRENT_PAGE':
			return { ...state, pagination: { ...state.pagination, currentPage: action.payload } };
		case 'SET_ROWS_PER_PAGE':
			return { ...state, pagination: { ...state.pagination, rowsPerPage: action.payload } };
		case 'SET_SHOW_MODAL':
			return { ...state, ui: { ...state.ui, showEditRecordModal: action.payload } };
		case 'SET_SHOW_CUSTOM_QUERY':
			return { ...state, ui: { ...state.ui, showCustomQuery: action.payload } };
		case 'SET_CUSTOM_QUERY':
			return { ...state, current: { ...state.current, customQuery: action.payload } };
		case 'SET_LOADING':
			return { ...state, ui: { ...state.ui, isLoading: action.payload } };
		case 'SET_ERROR':
			return { ...state, ui: { ...state.ui, error: action.payload } };
		case 'SET_SORT':
			return { ...state, sort: action.payload };
		case 'RESET_STATE':
			return initialState;
		default:
			return state;
	}
}

function useTableData( selectedSite: SiteDetails | undefined ) {
	const [ state, dispatch ] = useReducer( databaseReducer, initialState );
	const tableContainerRef = useRef< HTMLDivElement >( null );

	const fetchTables = useCallback( async () => {
		if ( ! selectedSite?.path ) {
			return;
		}
		try {
			dispatch( { type: 'SET_ERROR', payload: null } );
			dispatch( { type: 'SET_LOADING', payload: true } );
			const tables = ( await getIpcApi().executeSelectQuery(
				`${ selectedSite?.path }${ WP_DATABASE_PATH }`,
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'wp_%' ORDER BY name"
			) ) as unknown as { name: string; sql: string }[];
			dispatch( { type: 'SET_TABLES', payload: tables } );
		} catch ( err ) {
			console.error( 'Error fetching tables:', err );
			dispatch( {
				type: 'SET_ERROR',
				payload: err instanceof Error ? err.message : 'Failed to load database tables',
			} );
		} finally {
			dispatch( { type: 'SET_LOADING', payload: false } );
		}
	}, [ selectedSite?.path ] );

	const fetchTableColumns = useCallback(
		async ( table: Table ) => {
			if ( ! selectedSite?.path ) {
				return;
			}
			const columns = ( await getIpcApi().executeSelectQuery(
				`${ selectedSite?.path }${ WP_DATABASE_PATH }`,
				`PRAGMA table_info(${ table.name })`
			) ) as unknown as {
				name: string;
				type: string;
				pk: number;
				dflt_value: string;
				notnull: number;
			}[];
			dispatch( {
				type: 'SET_TABLE_COLUMNS',
				payload: columns.map( ( column ) => ( {
					name: column.name,
					type: column.type,
					pk: column.pk as 0 | 1,
					dflt_value: column.dflt_value,
					notnull: column.notnull as 0 | 1,
				} ) ),
			} );
		},
		[ selectedSite?.path ]
	);

	const fetchTableRows = useCallback(
		async ( table: Table ) => {
			if ( ! selectedSite?.path ) {
				return;
			}
			const offset = ( state.pagination.currentPage - 1 ) * state.pagination.rowsPerPage;
			const sortClause =
				state.sort.column && state.sort.direction
					? `ORDER BY ${ state.sort.column } ${ state.sort.direction }`
					: '';
			const rows = ( await getIpcApi().executeSelectQuery(
				`${ selectedSite?.path }${ WP_DATABASE_PATH }`,
				`SELECT * FROM ${ table.name } ${ sortClause } LIMIT ${ state.pagination.rowsPerPage } OFFSET ${ offset }`
			) ) as unknown as DatabaseRow[];
			dispatch( { type: 'SET_TABLE_ROWS', payload: rows } );

			const rowCount = ( await getIpcApi().executeSelectQuery(
				`${ selectedSite?.path }${ WP_DATABASE_PATH }`,
				`SELECT COUNT(*) as count FROM ${ table.name }`
			) ) as unknown as { count: number }[];
			dispatch( { type: 'SET_ROW_COUNT', payload: rowCount[ 0 ].count } );
			dispatch( { type: 'SET_LOADING', payload: false } );
			scrollToTop();
		},
		[
			selectedSite?.id,
			selectedSite?.path,
			state.pagination.currentPage,
			state.pagination.rowsPerPage,
			state.sort.column,
			state.sort.direction,
		]
	);

	const scrollToTop = useCallback( () => {
		tableContainerRef.current?.scrollTo( { top: 0, behavior: 'smooth' } );
	}, [] );

	const handleTableClick = useCallback(
		async ( table: Table ) => {
			try {
				dispatch( { type: 'SET_LOADING', payload: true } );
				// Reset sort state first
				dispatch( { type: 'SET_SORT', payload: { column: null, direction: null } } );
				dispatch( { type: 'SET_SELECTED_TABLE', payload: table } );
				dispatch( { type: 'SET_CURRENT_PAGE', payload: 1 } );

				// First fetch columns
				await fetchTableColumns( table );
			} catch ( error ) {
				console.error( 'Error loading table data:', error );
				dispatch( { type: 'SET_ERROR', payload: 'Failed to load table data' } );
			} finally {
				dispatch( { type: 'SET_LOADING', payload: false } );
			}
		},
		[ dispatch, fetchTableColumns ]
	);

	const handleColumnSort = useCallback(
		( column: TableColumn ) => {
			// If clicking the same column
			if ( state.sort.column === column.name ) {
				// Cycle through: asc -> desc -> null
				const newDirection =
					state.sort.direction === 'asc' ? 'desc' : state.sort.direction === 'desc' ? null : 'asc';

				dispatch( {
					type: 'SET_SORT',
					payload: newDirection
						? { column: column.name, direction: newDirection }
						: { column: null, direction: null },
				} );
			} else {
				// Clicking a new column, start with ascending sort
				dispatch( {
					type: 'SET_SORT',
					payload: { column: column.name, direction: 'asc' },
				} );
			}
		},
		[ state.sort, dispatch ]
	);

	useEffect( () => {
		dispatch( { type: 'SET_LOADING', payload: true } );

		if ( ! selectedSite?.id || ! selectedSite?.path || ! selectedSite?.themeDetails ) {
			return;
		}

		fetchTables();
		return () => {
			dispatch( { type: 'RESET_STATE' } );
		};
	}, [ selectedSite?.path, selectedSite?.id, selectedSite?.themeDetails, fetchTables ] );

	// Add effect to handle table selection changes
	useEffect( () => {
		if ( state.selected.table ) {
			fetchTableRows( state.selected.table );
		}
	}, [ state.selected.table, fetchTableRows ] );

	// Add effect to handle sort changes and pagination
	useEffect( () => {
		if ( state.selected.table && state.sort.column && state.sort.direction ) {
			fetchTableRows( state.selected.table );
		}
	}, [
		state.pagination.currentPage,
		state.sort.column,
		state.sort.direction,
		state.selected.table,
		fetchTableRows,
	] );

	return {
		state,
		dispatch,
		tableContainerRef,
		fetchTables,
		fetchTableColumns,
		fetchTableRows,
		scrollToTop,
		handleColumnSort,
		handleTableClick,
	};
}

function usePagination( state: DatabaseState, dispatch: React.Dispatch< DatabaseAction > ) {
	const totalPages = useMemo(
		() => Math.ceil( ( state.current.rowCount || 0 ) / state.pagination.rowsPerPage ),
		[ state.current.rowCount, state.pagination.rowsPerPage ]
	);

	const handleFirstPage = useCallback( () => {
		dispatch( { type: 'SET_CURRENT_PAGE', payload: 1 } );
	}, [ dispatch ] );

	const handleLastPage = useCallback( () => {
		dispatch( { type: 'SET_CURRENT_PAGE', payload: totalPages } );
	}, [ dispatch, totalPages ] );

	const handlePreviousPage = useCallback( () => {
		if ( state.pagination.currentPage > 1 ) {
			dispatch( { type: 'SET_CURRENT_PAGE', payload: state.pagination.currentPage - 1 } );
		}
	}, [ state.pagination.currentPage, dispatch ] );

	const handleNextPage = useCallback( () => {
		if ( state.pagination.currentPage < totalPages ) {
			dispatch( { type: 'SET_CURRENT_PAGE', payload: state.pagination.currentPage + 1 } );
		}
	}, [ state.pagination.currentPage, totalPages, dispatch ] );

	return {
		totalPages,
		handleFirstPage,
		handleLastPage,
		handlePreviousPage,
		handleNextPage,
	};
}

function useTableSelection( dispatch: React.Dispatch< DatabaseAction > ) {
	const handleRowClick = useCallback(
		( row: DatabaseRow, column: TableColumn ) => {
			if ( column.pk === 1 ) {
				return;
			}
			dispatch( { type: 'SET_SELECTED_ROW', payload: row } );
			dispatch( { type: 'SET_SELECTED_COLUMN', payload: column } );
			dispatch( { type: 'SET_SHOW_MODAL', payload: true } );
		},
		[ dispatch ]
	);

	return {
		handleRowClick,
	};
}

function useRowUpdate(
	state: DatabaseState,
	dispatch: React.Dispatch< DatabaseAction >,
	selectedSite: SiteDetails | undefined,
	fetchTableRows: ( table: Table ) => Promise< void >
) {
	const handleSave = useCallback( async () => {
		if ( ! selectedSite?.path ) {
			return;
		}
		try {
			if ( ! state.selected.table || ! state.selected.column || ! state.selected.row ) {
				throw new Error( 'Missing required data for update' );
			}

			const primaryKeyColumn = state.current.columns?.find( ( column ) => column.pk === 1 )?.name;
			if ( ! primaryKeyColumn ) {
				throw new Error( 'Could not find primary key column' );
			}

			const newValue = state.selected.row[ state.selected.column.name as string ];
			if ( newValue === undefined ) {
				throw new Error( 'New value is undefined' );
			}

			const primaryKeyValue = state.selected.row[ primaryKeyColumn as string ];
			if ( primaryKeyValue === undefined ) {
				throw new Error( 'Primary key value is undefined' );
			}

			const updateQuery = `UPDATE ${ state.selected.table.name } SET ${ state.selected.column.name } = ? WHERE ${ primaryKeyColumn } = ?`;
			const updateValues = [ newValue, primaryKeyValue ] as ( string | number )[];

			const { changes } = await getIpcApi().executeModificationQuery(
				`${ selectedSite?.path }${ WP_DATABASE_PATH }`,
				updateQuery,
				updateValues
			);

			if ( changes > 0 ) {
				await fetchTableRows( state.selected.table );
				dispatch( { type: 'SET_SHOW_MODAL', payload: false } );
			} else {
				throw new Error(
					'Update did not affect any rows. The row might not exist or the values might be incorrect.'
				);
			}
		} catch ( error ) {
			console.error( 'Error updating database:', error );
		}
	}, [
		state.selected.table,
		state.selected.column,
		state.selected.row,
		state.current.columns,
		selectedSite?.id,
		selectedSite?.path,
		dispatch,
		fetchTableRows,
	] );

	return { handleSave };
}

export function ContentTabDatabase( { selectedSite }: ContentTabDatabaseProps ) {
	const { state, dispatch, tableContainerRef, fetchTableRows, handleColumnSort, handleTableClick } =
		useTableData( selectedSite );

	const { handleFirstPage, handleLastPage, handlePreviousPage, handleNextPage } = usePagination(
		state,
		dispatch
	);

	const { handleRowClick } = useTableSelection( dispatch );
	const { handleSave } = useRowUpdate( state, dispatch, selectedSite, fetchTableRows );

	const filteredTables = useMemo(
		() =>
			state.current.tables.filter( ( table ) =>
				table.name.toLowerCase().includes( state.current.filter.toLowerCase() )
			),
		[ state.current.tables, state.current.filter ]
	);

	return (
		<div className="flex flex-col p-8" data-testid="import-export-supported">
			<div className="flex justify-between items-center mb-2">
				<div className="a8c-subtitle-small">{ __( 'Tables' ) }</div>
				{ state.ui.showCustomQuery && (
					<div className="flex items-center gap-2">
						<InputControl
							className="w-full min-w-96"
							value={
								state.current.customQuery
									? String( state.current.customQuery )
									: `SELECT ${ state.current.columns
											?.slice( 0, 2 )
											.map( ( column ) => column.name )
											.join( ', ' ) } FROM ${ state.selected.table?.name } LIMIT 10`
							}
							onChange={ ( value ) => {
								if ( typeof value === 'string' ) {
									dispatch( { type: 'SET_CUSTOM_QUERY', payload: value } );
								}
							} }
						/>
						<Button
							variant="secondary"
							onClick={ async () => {
								try {
									dispatch( { type: 'SET_LOADING', payload: true } );
									dispatch( { type: 'SET_ERROR', payload: null } );
									const query =
										state.current.customQuery ||
										`SELECT ${ state.current.columns
											?.slice( 0, 2 )
											.map( ( column ) => column.name )
											.join( ', ' ) } FROM ${ state.selected.table?.name } LIMIT 10`;

									// Check if this is a modification query (INSERT, UPDATE, DELETE)
									const isModificationQuery = /^(INSERT|UPDATE|DELETE)/i.test( query.trim() );
									// Execute the query with appropriate transaction handling
									const results = isModificationQuery
										? await getIpcApi().executeModificationQuery(
												`${ selectedSite?.path }${ WP_DATABASE_PATH }`,
												query,
												[] // Empty array for values since we're not using parameterized queries yet
										  )
										: await getIpcApi().executeSelectQuery(
												`${ selectedSite?.path }${ WP_DATABASE_PATH }`,
												query
										  );

									if ( isModificationQuery ) {
										// For modification queries, refresh the current table view
										if ( state.selected.table ) {
											await fetchTableRows( state.selected.table );
										}
										dispatch( { type: 'SET_SHOW_CUSTOM_QUERY', payload: false } );
										return;
									}

									// Handle SELECT query results
									const rows = results as unknown as DatabaseRow[];
									if ( rows.length === 0 ) {
										dispatch( { type: 'SET_TABLE_COLUMNS', payload: [] } );
										dispatch( { type: 'SET_TABLE_ROWS', payload: [] } );
										dispatch( { type: 'SET_ROW_COUNT', payload: 0 } );
									} else {
										// Extract column names from the first row
										const columns = Object.keys( rows[ 0 ] ).map( ( name ) => ( {
											name,
											type: 'TEXT', // Default type since we can't determine it from results
											pk: 0 as const,
											dflt_value: '',
											notnull: 0 as const,
										} ) );

										dispatch( { type: 'SET_TABLE_COLUMNS', payload: columns } );
										dispatch( { type: 'SET_TABLE_ROWS', payload: rows } );
										dispatch( { type: 'SET_ROW_COUNT', payload: rows.length } );
									}

									// Reset pagination and sort
									dispatch( { type: 'SET_CURRENT_PAGE', payload: 1 } );
									dispatch( { type: 'SET_SORT', payload: { column: null, direction: null } } );
								} catch ( error ) {
									console.error( 'Error executing custom query:', error );
									dispatch( {
										type: 'SET_ERROR',
										payload:
											error instanceof Error ? error.message : 'Failed to execute custom query',
									} );
								} finally {
									dispatch( { type: 'SET_LOADING', payload: false } );
								}
							} }
						>
							{ __( 'Run' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () => {
								dispatch( { type: 'SET_CUSTOM_QUERY', payload: '' } );
								dispatch( { type: 'SET_SHOW_CUSTOM_QUERY', payload: false } );
								// Reset the table back to the original selected table
								if ( state.selected.table ) {
									handleTableClick( state.selected.table );
									fetchTableRows( state.selected.table! );
								}
							} }
						>
							{ __( 'Close' ) }
						</Button>
					</div>
				) }
				{ state.selected.table && ! state.ui.showCustomQuery && (
					<Button
						variant="tertiary"
						onClick={ () => {
							dispatch( { type: 'SET_SHOW_CUSTOM_QUERY', payload: true } );
						} }
						icon={ <Icon icon={ keyboard } size={ 16 } /> }
						className="text-xs"
					>
						{ __( 'Custom query' ) }
					</Button>
				) }
			</div>
			<div className="flex gap-8 relative">
				<div className="w-48 flex-shrink-0 sticky top-0">
					<div className="flex flex-col gap-1">
						<SearchControl
							placeholder={ __( 'Filter tables...' ) }
							value={ state.current.filter }
							onChange={ ( value ) => dispatch( { type: 'SET_TABLE_FILTER', payload: value } ) }
							__nextHasNoMarginBottom
							size="compact"
						/>
						{ state.ui.isLoading ? (
							<div className="flex items-center justify-center py-4">
								<Spinner />
							</div>
						) : state.ui.error ? (
							<div className="text-red-500 text-xs p-2">{ state.ui.error }</div>
						) : (
							<ol className="list-none">
								{ filteredTables.map( ( table ) => {
									const isSelected = state.selected.table?.name === table.name;
									return (
										<li key={ table.name }>
											<Button
												icon={ layout }
												variant={ isSelected ? 'primary' : 'tertiary' }
												disabled={ isSelected }
												isPressed={ isSelected }
												className="text-xs w-full justify-start [&.is-pressed:disabled]:text-white"
												onClick={ () => handleTableClick( table ) }
												iconSize={ 16 }
											>
												{ table.name }
											</Button>
										</li>
									);
								} ) }
							</ol>
						) }
					</div>
				</div>

				<div className="flex-1 min-w-0">
					<div className="h-full flex flex-col">
						{ state.ui.isLoading ? (
							<div className="flex items-center justify-center w-full h-full">
								<Spinner />
							</div>
						) : state.ui.error ? (
							<div className="text-red-500 text-sm p-4">{ state.ui.error }</div>
						) : state.selected.table ? (
							<div className="flex flex-col">
								<div
									ref={ tableContainerRef }
									className="overflow-x-auto max-h-[calc(100vh-300px)]"
								>
									<table className="table-fixed border divide-y divide-gray-200">
										<thead className="bg-gray-50">
											<tr>
												{ state.current.columns?.map( ( column ) => (
													<th
														key={ column.name }
														className="px-2 py-1 text-left text-xs lowercase tracking-wider font-normal whitespace-nowrap cursor-pointer hover:bg-gray-100"
														onClick={ () => handleColumnSort( column ) }
													>
														<div className="flex items-center gap-1 text-xs">
															{ column.pk === 1 ? <Icon icon={ key } size={ 16 } /> : null }
															<span>{ column.name }</span>
															<span className="text-gray-500">{ column.type }</span>
															{ state.sort.column === column.name && (
																<Icon
																	icon={ state.sort.direction === 'asc' ? chevronUp : chevronDown }
																	size={ 16 }
																	className="text-gray-500"
																/>
															) }
														</div>
													</th>
												) ) }
											</tr>
										</thead>
										<tbody className="bg-white divide-y divide-gray-200">
											{ state.current.rows?.length
												? state.current.rows?.map( ( row, rowIndex ) => (
														<tr key={ rowIndex } className="hover:bg-gray-50">
															{ state.current.columns?.map( ( column ) => (
																<td
																	key={ `row-${ rowIndex }-${ column.name }` }
																	tabIndex={ 0 }
																	onClick={ () => handleRowClick( row, column ) }
																	className="px-2 py-1 text-xs text-left text-gray-900 truncate focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-blue-50 max-w-[200px]"
																>
																	{ String( row[ column.name ] ) !== '' ? (
																		String( row[ column.name ] )
																	) : (
																		<span className="text-gray-500">null</span>
																	) }
																</td>
															) ) }
														</tr>
												  ) )
												: null }
										</tbody>
									</table>
								</div>
							</div>
						) : (
							<div className="text-gray-500">Select a table from the list to view its details</div>
						) }
						{ state.selected.table && (
							<div className="flex items-center gap-2 text-gray-500 py-1 text-xs italic whitespace-nowrap justify-between">
								<span className="justify-start">
									Total rows: { state.current.rowCount } | Page { state.pagination.currentPage } of{ ' ' }
									{ Math.ceil( ( state.current.rowCount || 0 ) / state.pagination.rowsPerPage ) }
								</span>
								<div className="flex items-center gap-1">
									<SelectControl
										label={ __( 'Rows per page' ) }
										value={ state.pagination.rowsPerPage.toString() as '10' | '20' | '50' | '100' }
										onChange={ ( value ) =>
											dispatch( { type: 'SET_ROWS_PER_PAGE', payload: parseInt( value, 10 ) } )
										}
										size="compact"
										labelPosition="edge"
										options={ [
											{ label: '10', value: '10' },
											{ label: '20', value: '20' },
											{ label: '50', value: '50' },
											{ label: '100', value: '100' },
										] }
									/>
									<Button
										icon={ <Icon icon={ previous } size={ 16 } /> }
										variant="secondary"
										size="small"
										onClick={ handleFirstPage }
										disabled={ state.pagination.currentPage === 1 || state.ui.isLoading }
										showTooltip
										iconSize={ 16 }
										label={ __( 'First' ) }
									/>
									<Button
										icon={ <Icon icon={ chevronLeft } size={ 16 } /> }
										variant="secondary"
										size="small"
										onClick={ handlePreviousPage }
										disabled={ state.pagination.currentPage === 1 || state.ui.isLoading }
										showTooltip
										iconSize={ 16 }
										label={ __( 'Previous' ) }
									/>
									<Button
										icon={ <Icon icon={ chevronRight } size={ 16 } /> }
										variant="secondary"
										size="small"
										onClick={ handleNextPage }
										disabled={
											state.pagination.currentPage >=
												Math.ceil(
													( state.current.rowCount || 0 ) / state.pagination.rowsPerPage
												) || state.ui.isLoading
										}
										showTooltip
										iconSize={ 16 }
										label={ __( 'Next' ) }
									/>
									<Button
										icon={ <Icon icon={ next } size={ 16 } /> }
										variant="secondary"
										size="small"
										onClick={ handleLastPage }
										disabled={
											state.pagination.currentPage >=
												Math.ceil(
													( state.current.rowCount || 0 ) / state.pagination.rowsPerPage
												) || state.ui.isLoading
										}
										showTooltip
										iconSize={ 16 }
										label={ __( 'Last' ) }
									/>
									{ /* TODO: Refresh the table rows for custom queries doesn't work */ }
									<Button
										icon={ <Icon icon={ update } size={ 16 } /> }
										variant="tertiary"
										size="small"
										onClick={ () => fetchTableRows( state.selected.table! ) }
										isBusy={ state.ui.isLoading }
										disabled={ state.ui.isLoading }
										showTooltip
										iconSize={ 16 }
									>
										{ __( 'Refresh' ) }
									</Button>
								</div>
							</div>
						) }
					</div>
				</div>
			</div>
			{ state.ui.showEditRecordModal && (
				<EditRecordModal
					table={ state.selected.table ?? { name: '' } }
					column={ state.selected.column ?? { name: '', type: '' } }
					row={ state.selected.row ?? {} }
					onClose={ () => dispatch( { type: 'SET_SHOW_MODAL', payload: false } ) }
					onSave={ () => handleSave() }
					onChange={ ( value: string | number ) => {
						const newValue =
							state.selected.column?.type === 'INTEGER' ? parseInt( value as string, 10 ) : value;
						dispatch( {
							type: 'SET_SELECTED_ROW',
							payload: state.selected.row
								? {
										...state.selected.row,
										[ state.selected.column?.name as string ]: newValue,
								  }
								: null,
						} );
					} }
				/>
			) }
		</div>
	);
}
