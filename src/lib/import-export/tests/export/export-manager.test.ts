import { exportBackup } from '../../export/export-manager';
import { ExportOptions, NewExporter } from '../../export/types';

describe( 'exportBackup', () => {
	let mockExportOptions: ExportOptions;
	beforeEach( () => {
		mockExportOptions = {} as ExportOptions;
		console.log = jest.fn(); // Mock console.log
	} );

	it( 'should call export on the first exporter that can handle the options', async () => {
		const mockExport = jest.fn();
		const mockCanHandle = jest.fn().mockResolvedValue( true );

		const MockExporter1 = jest.fn().mockImplementation( () => ( {
			canHandle: mockCanHandle,
			export: mockExport,
			on: jest.fn(),
			emit: jest.fn(),
		} ) );

		const MockExporter2 = jest.fn().mockImplementation( () => ( {
			canHandle: mockCanHandle,
			export: mockExport,
			on: jest.fn(),
			emit: jest.fn(),
		} ) );

		const exporters: NewExporter[] = [ MockExporter1, MockExporter2 ];
		await exportBackup( mockExportOptions, exporters );

		expect( MockExporter1 ).toHaveBeenCalledWith( mockExportOptions );
		expect( mockCanHandle ).toHaveBeenCalled();
		expect( mockExport ).toHaveBeenCalled();
		expect( MockExporter2 ).not.toHaveBeenCalled();
	} );

	it( 'should call the second exporter if first exporter can not handle export', async () => {
		const ExportMethod1 = jest.fn();
		const MockExporter1 = jest.fn().mockImplementation( () => ( {
			canHandle: jest.fn().mockResolvedValue( false ),
			export: ExportMethod1,
			on: jest.fn(),
			emit: jest.fn(),
		} ) );

		const ExportMethod2 = jest.fn();
		const MockExporter2 = jest.fn().mockImplementation( () => ( {
			canHandle: jest.fn().mockResolvedValue( true ),
			export: ExportMethod2,
			on: jest.fn(),
			emit: jest.fn(),
		} ) );

		const exporters: NewExporter[] = [ MockExporter1, MockExporter2 ];
		await exportBackup( mockExportOptions, exporters );

		expect( MockExporter1 ).toHaveBeenCalledWith( mockExportOptions );
		expect( ExportMethod1 ).not.toHaveBeenCalled();
		expect( MockExporter2 ).toHaveBeenCalledWith( mockExportOptions );
		expect( ExportMethod2 ).toHaveBeenCalled();
	} );
} );
