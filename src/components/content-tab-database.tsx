import { __ } from '@wordpress/i18n';
import { useEffect, useState, useRef } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	key,
	layout,
	Icon,
	update,
	chevronLeft,
	chevronRight,
	previous,
	next,
} from '@wordpress/icons';
import {
	Button,
	SearchControl,
	TextareaControl,
	__experimentalInputControl as InputControl,
	Spinner,
} from '@wordpress/components';
import Modal from 'src/components/modal';

interface ContentTabDatabaseProps {
	selectedSite: SiteDetails;
}

interface Table {
	name: string;
	sql: string;
}

interface TableColumn {
	name: string;
	type: string;
	pk: 0 | 1;
	dflt_value: string;
	notnull: 0 | 1;
}

export function ContentTabDatabase( { selectedSite }: ContentTabDatabaseProps ) {
	const [ showModal, setShowModal ] = useState( false );
	const [ tables, setTables ] = useState< Table[] >( [] );
	const [ selectedTable, setSelectedTable ] = useState< Table | null >( null );
	const [ tableColumns, setTableColumns ] = useState< TableColumn[] | null >( null );
	const [ tableRows, setTableRows ] = useState< Record< string, unknown >[] | null >( null );
	const [ tableFilter, setTableFilter ] = useState( '' );
	const [ selectedRow, setSelectedRow ] = useState< Record< string, unknown > | null >( null );
	const [ rowCount, setRowCount ] = useState< number | null >( null );
	const [ selectedColumn, setSelectedColumn ] = useState< TableColumn | null >( null );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );
	const [ currentPage, setCurrentPage ] = useState( 1 );
	const [ rowsPerPage ] = useState( 20 );
	const tableContainerRef = useRef< HTMLDivElement >( null );

	const fetchTables = async () => {
		try {
			setError( null );
			setIsLoading( true );
			// First get all tables
			const tables = ( await getIpcApi().executeSelectQuery(
				selectedSite?.id,
				`${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
				"SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
			) ) as unknown as { name: string; sql: string }[];
			setTables( tables );
		} catch ( err ) {
			console.error( 'Error fetching tables:', err );
			setError( err instanceof Error ? err.message : 'Failed to load database tables' );
		} finally {
			setIsLoading( false );
		}
	};

	useEffect( () => {
		setIsLoading( true );

		// @ TODO - is there a better way to check if the db is loaded aside from themeDetails?
		if ( ! selectedSite?.id || ! selectedSite?.path || ! selectedSite?.themeDetails ) {
			return;
		}

		/*
		 * Reset the selected table when the path (selected site) changes,
		 * to ensure that the correct tables are displayed.
		 */
		setSelectedTable( null );
		setTableColumns( null );
		setTableRows( null );
		setSelectedRow( null );
		setSelectedColumn( null );
		fetchTables();
	}, [ selectedSite?.path, selectedSite?.id, selectedSite?.themeDetails ] );

	const fetchTableColumns = async ( table: Table ) => {
		const columns = ( await getIpcApi().executeSelectQuery(
			selectedSite?.id,
			`${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
			`PRAGMA table_info( ${ table.name } )`
		) ) as unknown as {
			name: string;
			type: string;
			pk: number;
			dflt_value: string;
			notnull: number;
		}[];
		setTableColumns(
			columns.map( ( column ) => ( {
				name: column.name,
				type: column.type,
				pk: column.pk as 0 | 1,
				dflt_value: column.dflt_value,
				notnull: column.notnull as 0 | 1,
			} ) )
		);
	};

	const fetchTableRows = async ( table: Table ) => {
		const offset = ( currentPage - 1 ) * rowsPerPage;
		const rows = ( await getIpcApi().executeSelectQuery(
			selectedSite?.id,
			`${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
			`SELECT * FROM ${ table.name } LIMIT ${ rowsPerPage } OFFSET ${ offset }`
		) ) as unknown as { name: string; type: string }[];
		setTableRows( rows );
		// Get row count
		const rowCount = ( await getIpcApi().executeSelectQuery(
			selectedSite?.id,
			`${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
			`SELECT COUNT(*) as count FROM ${ table.name }`
		) ) as unknown as { count: number }[];
		setRowCount( rowCount[ 0 ].count );
		setIsLoading( false );
		scrollToTop();
	};

	const handleTableClick = ( table: Table ) => {
		setIsLoading( true );
		setSelectedTable( table );
		setCurrentPage( 1 ); // Reset to first page when selecting a new table
		fetchTableColumns( table );
		fetchTableRows( table );
	};

	const handleRowClick = ( row: Record< string, unknown >, column: TableColumn ) => {
		if ( column.pk === 1 ) {
			return;
		}
		console.log( 'column', column );
		setSelectedRow( row );
		setSelectedColumn( column );
		setShowModal( true );
	};

	const handleSave = async () => {
		try {
			if ( ! selectedTable || ! selectedColumn || ! selectedRow ) {
				throw new Error( 'Missing required data for update' );
			}

			const primaryKeyColumn = tableColumns?.find( ( column ) => column.pk === 1 )?.name;
			if ( ! primaryKeyColumn ) {
				throw new Error( 'Could not find primary key column' );
			}

			// Validate the new value
			const newValue = selectedRow[ selectedColumn.name as string ];
			if ( newValue === undefined ) {
				throw new Error( 'New value is undefined' );
			}

			// Validate the primary key value
			const primaryKeyValue = selectedRow[ primaryKeyColumn as string ];
			if ( primaryKeyValue === undefined ) {
				throw new Error( 'Primary key value is undefined' );
			}

			const updateQuery = `UPDATE ${ selectedTable.name } SET ${ selectedColumn.name } = ? WHERE ${ primaryKeyColumn } = ?`;
			const updateValues = [ newValue, primaryKeyValue ];

			console.log( 'Executing update:', {
				table: selectedTable.name,
				column: selectedColumn.name,
				newValue,
				primaryKey: primaryKeyColumn,
				primaryKeyValue,
			} );

			const { changes, lastInsertRowid } = await getIpcApi().executeModificationQuery(
				selectedSite?.id,
				`${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
				updateQuery,
				updateValues
			);

			if ( changes > 0 ) {
				// Refresh the table data
				await fetchTableRows( selectedTable );
				setShowModal( false );
			} else {
				throw new Error(
					'Update did not affect any rows. The row might not exist or the values might be incorrect.'
				);
			}
		} catch ( error ) {
			console.error( 'Error updating database:', error );
		}
	};

	const scrollToTop = () => {
		tableContainerRef.current?.scrollTo( { top: 0, behavior: 'smooth' } );
	};

	const handleFirstPage = () => {
		setCurrentPage( 1 );
		scrollToTop();
	};

	const handleLastPage = () => {
		const totalPages = Math.ceil( ( rowCount || 0 ) / rowsPerPage );
		setCurrentPage( totalPages );
		scrollToTop();
	};

	const handlePreviousPage = () => {
		if ( currentPage > 1 ) {
			setCurrentPage( currentPage - 1 );
			scrollToTop();
		}
	};

	const handleNextPage = () => {
		const totalPages = Math.ceil( ( rowCount || 0 ) / rowsPerPage );
		if ( currentPage < totalPages ) {
			setCurrentPage( currentPage + 1 );
			scrollToTop();
		}
	};

	// Add effect to fetch data when page changes
	useEffect( () => {
		if ( selectedTable ) {
			fetchTableRows( selectedTable );
		}
	}, [ currentPage, selectedTable ] );

	const filteredTables = tables.filter( ( table ) =>
		table.name.toLowerCase().includes( tableFilter.toLowerCase() )
	);

	return (
		<div className="flex flex-col p-8" data-testid="import-export-supported">
			<div className="flex justify-between items-center mb-2">
				<div className="a8c-subtitle-small">{ __( 'Tables' ) }</div>
			</div>
			<div className="flex gap-8 relative">
				<div className="w-48 flex-shrink-0 sticky top-0">
					<div className="flex flex-col gap-1">
						<SearchControl
							placeholder={ __( 'Filter tables...' ) }
							value={ tableFilter }
							onChange={ setTableFilter }
							__nextHasNoMarginBottom
							size="compact"
						/>
						{ isLoading ? (
							<div className="flex items-center justify-center py-4">
								<Spinner />
							</div>
						) : error ? (
							<div className="text-red-500 text-xs p-2">{ error }</div>
						) : (
							<ol className="list-none">
								{ filteredTables.map( ( table ) => {
									const isSelected = selectedTable?.name === table.name;
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
						{ isLoading ? (
							<div className="flex items-center justify-center w-full h-full">
								<Spinner />
							</div>
						) : error ? (
							<div className="text-red-500 text-sm p-4">{ error }</div>
						) : selectedTable ? (
							<div className="flex flex-col">
								<div
									ref={ tableContainerRef }
									className="overflow-x-auto max-h-[calc(100vh-300px)]"
								>
									<table className="table-fixed border divide-y divide-gray-200">
										<thead className="bg-gray-50">
											<tr>
												{ tableColumns?.map( ( column ) => (
													<th
														key={ column.name }
														className="px-2 py-1 text-left text-xs lowercase tracking-wider font-normal whitespace-nowrap"
													>
														<div className="flex items-center gap-1 text-xs">
															{ column.pk === 1 ? <Icon icon={ key } size={ 16 } /> : null }
															<span>{ column.name }</span>
															<span className="text-gray-500">{ column.type }</span>
														</div>
													</th>
												) ) }
											</tr>
										</thead>
										<tbody className="bg-white divide-y divide-gray-200">
											{ tableRows?.length
												? tableRows?.map( ( row, rowIndex ) => (
														<tr key={ rowIndex } className="hover:bg-gray-50">
															{ tableColumns?.map( ( column ) => (
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
						{ selectedTable && (
							<div className="flex items-center gap-2 text-gray-500 py-1 text-xs italic whitespace-nowrap justify-between">
								<span className="justify-start">
									Total rows: { rowCount } | Page { currentPage } of{ ' ' }
									{ Math.ceil( ( rowCount || 0 ) / rowsPerPage ) }
								</span>
								<div className="flex items-center gap-1">
									<Button
										icon={ <Icon icon={ previous } size={ 16 } /> }
										variant="secondary"
										size="small"
										onClick={ handleFirstPage }
										disabled={ currentPage === 1 || isLoading }
										showTooltip
										iconSize={ 16 }
										label={ __( 'First' ) }
									/>
									<Button
										icon={ <Icon icon={ chevronLeft } size={ 16 } /> }
										variant="secondary"
										size="small"
										onClick={ handlePreviousPage }
										disabled={ currentPage === 1 || isLoading }
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
											currentPage >= Math.ceil( ( rowCount || 0 ) / rowsPerPage ) || isLoading
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
											currentPage >= Math.ceil( ( rowCount || 0 ) / rowsPerPage ) || isLoading
										}
										showTooltip
										iconSize={ 16 }
										label={ __( 'Last' ) }
									/>
									<Button
										icon={ <Icon icon={ update } size={ 16 } /> }
										variant="tertiary"
										size="small"
										onClick={ () => fetchTableRows( selectedTable ) }
										isBusy={ isLoading }
										disabled={ isLoading }
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
			{ showModal && (
				<Modal
					size="medium"
					title={ `Editing ${ selectedColumn?.name } from ${ selectedTable?.name }` }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ () => setShowModal( false ) }
					className="max-h-[90%]"
				>
					<div>
						{ selectedColumn?.type === 'INTEGER' && (
							<InputControl
								className="mb-4"
								type="number"
								value={ String( selectedRow?.[ selectedColumn?.name as string ] ?? '' ) }
								onChange={ ( value ) => {
									setSelectedRow( {
										...selectedRow,
										[ selectedColumn?.name as string ]: parseInt( value || '0' ),
									} );
								} }
							/>
						) }
						{ selectedColumn?.type === 'TEXT' && (
							<TextareaControl
								className="mb-4"
								value={ selectedRow?.[ selectedColumn?.name as string ] as string }
								onChange={ ( value ) => {
									setSelectedRow( { ...selectedRow, [ selectedColumn?.name as string ]: value } );
								} }
							/>
						) }
						<div className="flex justify-end gap-2">
							<Button variant="primary" onClick={ () => handleSave() }>
								{ __( 'Save' ) }
							</Button>
							<Button variant="secondary" onClick={ () => setShowModal( false ) }>
								{ __( 'Cancel' ) }
							</Button>
						</div>
					</div>
				</Modal>
			) }
		</div>
	);
}
