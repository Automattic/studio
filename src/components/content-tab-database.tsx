import { __ } from '@wordpress/i18n';
import {
	useEffect,
	useState,
} from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { key, layout, Icon } from '@wordpress/icons';
import { Button, SearchControl, TextareaControl } from '@wordpress/components';
import Modal from 'src/components/modal';

interface ContentTabDatabaseProps {
	selectedSite: SiteDetails;
}

interface Table {
	name: string;
	columns: number;
	rows: number;
	description: string;
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
    const [ selectedTable, setSelectedTable ] = useState<Table | null>( null );
    const [ tableColumns, setTableColumns ] = useState< TableColumn[] | null >( null );
    const [ tableRows, setTableRows ] = useState< Record<string, unknown>[] | null >( null );
    const [ tableFilter, setTableFilter ] = useState( '' );
    const [ selectedRow, setSelectedRow ] = useState< Record<string, unknown> | null >( null );
    const [ selectedColumn, setSelectedColumn ] = useState< TableColumn | null >( null );

	useEffect( () => {
        const fetchTables = async () => {
            // First get all tables
            const tables = ( await getIpcApi().executeSelectQuery(
                `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
				'SELECT name, sql FROM sqlite_master WHERE type=\'table\' ORDER BY name'
			) as unknown ) as { name: string; sql: string }[];

            // Then get row count and column info for each table
            const tablesWithInfo = await Promise.all( tables.map( async ( table ) => {
                // Get row count
                const rowCount = ( await getIpcApi().executeSelectQuery(
                    `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
                    `SELECT COUNT(*) as count FROM ${ table.name }`
                ) as unknown ) as { count: number }[];

                // Get column info
                const columnInfo = ( await getIpcApi().executeSelectQuery(
                    `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
                    `PRAGMA table_info( ${ table.name } )`
                ) as unknown) as { name: string; type: string }[];

                return {
                    name: table.name,
                    columns: columnInfo.length,
                    rows: rowCount[0].count,
                    description: table.sql
                };
            } ) );
            setTables( tablesWithInfo );
		};
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
	}, [ selectedSite?.path ] );


    const fetchTableColumns = async ( table: Table ) => {
        const columns = ( await getIpcApi().executeSelectQuery(
            `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
            `PRAGMA table_info( ${ table.name } )`
        ) as unknown) as { name: string; type: string; pk: number; dflt_value: string; notnull: number }[];
        setTableColumns( columns.map( ( column ) => ( { name: column.name, type: column.type, pk: column.pk as 0 | 1, dflt_value: column.dflt_value, notnull: column.notnull as 0 | 1 } ) ) );
    };

    const fetchTableRows = async ( table: Table ) => {
        const rows = ( await getIpcApi().executeSelectQuery(
            `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
            `SELECT * FROM ${ table.name }`
        ) as unknown) as { name: string; type: string }[];
        setTableRows( rows );
    };

    const handleTableClick = ( table: Table ) => {
        setSelectedTable( table );
        fetchTableColumns( table );
        fetchTableRows( table );
    };

    const handleRowClick = ( row: Record<string, unknown>, column: TableColumn ) => {
        if ( column.pk === 1 ) {
            return;
        }
        setSelectedRow( row );
        setSelectedColumn( column );
        setShowModal( true );
    };

    const handleSave = async () => {
        const primaryKeyColumn = tableColumns?.find( column => column.pk === 1 )?.name;
        const updateQuery = `UPDATE ${ selectedTable?.name } SET ${ selectedColumn?.name } = ? WHERE ${ primaryKeyColumn } = ?`;
        const updateValues = [ selectedRow?.[ selectedColumn?.name as string ], selectedRow?.[ primaryKeyColumn as string ] ];
                const { changes, lastInsertRowid } = await getIpcApi().executeModificationQuery(
            `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
            updateQuery,
            updateValues
        );
        if ( changes > 0 && selectedTable ) {
            fetchTableRows( selectedTable );
            setShowModal( false );
        }
    };

    const filteredTables = tables.filter( table => 
        table.name.toLowerCase().includes( tableFilter.toLowerCase() )
    );


	return (
        <div className="flex flex-col p-8" data-testid="import-export-supported">
            <div className="a8c-subtitle-small mb-4">{ __( 'Tables' ) }</div>
            <div className="flex gap-8">
                <div className="w-48 flex-shrink-0">
                    <div className="flex flex-col gap-1">
                        <SearchControl
                            placeholder={ __( 'Filter tables...' ) }
                            value={ tableFilter }
                            onChange={ setTableFilter }
                            __nextHasNoMarginBottom
                            size="compact"
                        />
                        <ol className="list-none">
                            { filteredTables.map( ( table ) => {
                                const isSelected = selectedTable?.name === table.name;
                                return (
                                    <li 
                                        key={table.name} 
                                    >
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
                    </div>
                </div>

                <div className="flex-1 overflow-x-auto justify-start">
                    <div className="h-full flex items-start">
                        { selectedTable ? (
                            <div className="w-full overflow-x-auto border">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            { tableColumns?.map((column) => (
                                                <th 
                                                    key={ column.name }
                                                    className="px-2 py-1 text-left text-xs lowercase tracking-wider font-normal"
                                                >
                                                    <div className="flex items-center gap-1 text-xs">
                                                        { column.pk === 1 ? <Icon icon={ key } size={ 16 } /> : null } 
                                                        <span>{ column.name }</span>
                                                        <span className="text-gray-500">{ column.type }</span>
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        { tableRows?.map( ( row, rowIndex ) => (
                                            <tr key={ rowIndex } className="hover:bg-gray-50">
                                                { tableColumns?.map( ( column ) => (
                                                    <td 
                                                        key={ `row-${ rowIndex }-${ column.name }`}
                                                        tabIndex={0}
                                                        onClick={ () => handleRowClick( row, column ) }
                                                        className="max-w-[150px] px-2 py-1 text-xs text-gray-900 truncate focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-blue-50"
                                                    >
                                                        { String( row[ column.name ] ) !== '' ? String( row[ column.name ] ) : <span className="text-gray-500">null</span> }
                                                    </td>
                                                ) ) }
                                            </tr>
                                        ) ) }
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-gray-500">Select a table from the list to view its details</div>
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
                        <TextareaControl
                            value={ selectedRow?.[ selectedColumn?.name as string ] as string }
                            onChange={ ( value ) => {
                                setSelectedRow( { ...selectedRow, [ selectedColumn?.name as string ]: value } );
                            } }
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="primary" onClick={ () => handleSave() }>{ __( 'Save' ) }</Button>
                            <Button variant="secondary" onClick={ () => setShowModal( false ) }>{ __( 'Cancel' ) }</Button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}
