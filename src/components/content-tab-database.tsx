import { __ } from '@wordpress/i18n';
import {
	useEffect,
	useState,
} from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { key, layout, Icon } from '@wordpress/icons';
import { Button } from '@wordpress/components';

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
	const [ tables, setTables ] = useState< Table[] >( [] );
    const [ selectedTable, setSelectedTable ] = useState<Table | null>( null );
    const [ tableColumns, setTableColumns ] = useState< TableColumn[] | null >( null );
    const [ tableRows, setTableRows ] = useState< Record<string, unknown>[] | null >( null );
 
	useEffect( () => {
        const fetchTables = async () => {
            // First get all tables
            const tables = ( await getIpcApi().executeQuery(
                `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
				'SELECT name, sql FROM sqlite_master WHERE type=\'table\' ORDER BY name'
			) as unknown ) as { name: string; sql: string }[];

            // Then get row count and column info for each table
            const tablesWithInfo = await Promise.all( tables.map( async ( table ) => {
                // Get row count
                const rowCount = ( await getIpcApi().executeQuery(
                    `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
                    `SELECT COUNT(*) as count FROM ${ table.name }`
                ) as unknown ) as { count: number }[];

                // Get column info
                const columnInfo = ( await getIpcApi().executeQuery(
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
		fetchTables();
	}, [ selectedSite ] );


    const fetchTableColumns = async ( table: Table ) => {
        const columns = ( await getIpcApi().executeQuery(
            `${ selectedSite?.path }/wp-content/database/.ht.sqlite`,
            `PRAGMA table_info( ${ table.name } )`
        ) as unknown) as { name: string; type: string; pk: number; dflt_value: string; notnull: number }[];
        console.log( columns );
        setTableColumns( columns.map( ( column ) => ( { name: column.name, type: column.type, pk: column.pk as 0 | 1, dflt_value: column.dflt_value, notnull: column.notnull as 0 | 1 } ) ) );
    };

    const fetchTableRows = async ( table: Table ) => {
        const rows = ( await getIpcApi().executeQuery(
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

	return (
        <div className="flex flex-col p-8 gap-8" data-testid="import-export-supported">
            <div className="flex gap-8">
                <div className="w-64 flex-shrink-0">
                    <div className="a8c-subtitle-small mb-4">{ __( 'Tables' ) }</div>
                    <div className="flex flex-col gap-1">
                        <ol className="list-none">
                            { tables.map( ( table ) => (
                                <li 
                                    key={table.name} 
                                >
                                    <Button icon={ layout } variant="tertiary" disabled={ selectedTable?.name === table.name} className="text-xs" onClick={ () => handleTableClick( table ) }>
                                        { table.name } ( { table.rows } rows )
                                    </Button>
                                </li>
                            ) ) }
                        </ol>
                    </div>
                </div>

                <div className="flex-1 overflow-x-auto justify-start">
                    <div className="h-full flex items-start mt-12">
                        <div className="p-4 border rounded">
                            { selectedTable ? (
                                <div className="w-full overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                { tableColumns?.map((column) => (
                                                    <th 
                                                        key={ column.name }
                                                        className="px-6 py-3 text-left text-xs lowercase tracking-wider font-normal"
                                                    >
                                                        { column.pk === 1 ? <Icon icon={ key } size={ 16 } /> : null } 
                                                        <span className="text-xs">{ column.name }</span>
                                                        <span className="text-xs text-gray-500 ml-1">{ column.type }</span>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            { tableRows?.map( ( row, rowIndex ) => (
                                                <tr key={ rowIndex }>
                                                    { tableColumns?.map( ( column ) => (
                                                        <td 
                                                            key={ `row-${ rowIndex }-${ column.name }`}
                                                            className="px-6 py-4 whitespace-nowrap text-xs text-gray-900"
                                                        >
                                                            { String( row[ column.name ] ?? '' ) }
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
            </div>
        </div>
    );
}
