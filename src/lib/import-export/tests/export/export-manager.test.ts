import { vi, describe, it, expect, beforeEach } from 'vitest';
import { exportBackup } from 'src/lib/import-export/export/export-manager';
import { ExportOptions, NewExporter } from 'src/lib/import-export/export/types';

describe( 'exportBackup', () => {
	let mockExportOptions: ExportOptions;
	beforeEach( () => {
		mockExportOptions = {} as ExportOptions;
		console.log = vi.fn();
	} );

	it( 'should call export on the first exporter that can handle the options', async () => {
		const mockExport = vi.fn();
		const mockCanHandle = vi.fn().mockResolvedValue( true );

		const MockExporter1 = vi.fn().mockImplementation( () => ( {
			canHandle: mockCanHandle,
			export: mockExport,
			on: vi.fn(),
			emit: vi.fn(),
		} ) );

		const MockExporter2 = vi.fn().mockImplementation( () => ( {
			canHandle: mockCanHandle,
			export: mockExport,
			on: vi.fn(),
			emit: vi.fn(),
		} ) );

		const exporters: NewExporter[] = [ MockExporter1, MockExporter2 ];
		const result = await exportBackup( mockExportOptions, vi.fn(), exporters );

		expect( result ).toBeTruthy();
		expect( MockExporter1 ).toHaveBeenCalledWith( mockExportOptions );
		expect( mockCanHandle ).toHaveBeenCalled();
		expect( mockExport ).toHaveBeenCalled();
		expect( MockExporter2 ).not.toHaveBeenCalled();
	} );

	it( 'should call the second exporter if first exporter can not handle export', async () => {
		const ExportMethod1 = vi.fn();
		const MockExporter1 = vi.fn().mockImplementation( () => ( {
			canHandle: vi.fn().mockResolvedValue( false ),
			export: ExportMethod1,
			on: vi.fn(),
			emit: vi.fn(),
		} ) );

		const ExportMethod2 = vi.fn();
		const MockExporter2 = vi.fn().mockImplementation( () => ( {
			canHandle: vi.fn().mockResolvedValue( true ),
			export: ExportMethod2,
			on: vi.fn(),
			emit: vi.fn(),
		} ) );

		const exporters: NewExporter[] = [ MockExporter1, MockExporter2 ];
		const result = await exportBackup( mockExportOptions, vi.fn(), exporters );

		expect( result ).toBeTruthy();
		expect( MockExporter1 ).toHaveBeenCalledWith( mockExportOptions );
		expect( ExportMethod1 ).not.toHaveBeenCalled();
		expect( MockExporter2 ).toHaveBeenCalledWith( mockExportOptions );
		expect( ExportMethod2 ).toHaveBeenCalled();
	} );

	it( 'returns false if no exporter is found', async () => {
		const ExportMethod1 = vi.fn();
		const MockExporter1 = vi.fn( () => ( {
			canHandle: vi.fn().mockResolvedValue( false ),
			export: ExportMethod1,
			on: vi.fn(),
			emit: vi.fn(),
		} ) );

		const ExportMethod2 = vi.fn();
		const MockExporter2 = vi.fn( () => ( {
			canHandle: vi.fn().mockResolvedValue( false ),
			export: ExportMethod2,
			on: vi.fn(),
			emit: vi.fn(),
		} ) );

		const exporters: NewExporter[] = [ MockExporter1, MockExporter2 ];
		const result = await exportBackup( mockExportOptions, vi.fn(), exporters );

		expect( result ).toBeFalsy();
		expect( MockExporter1 ).toHaveBeenCalledWith( mockExportOptions );
		expect( ExportMethod1 ).not.toHaveBeenCalled();
		expect( MockExporter2 ).toHaveBeenCalledWith( mockExportOptions );
		expect( ExportMethod2 ).not.toHaveBeenCalled();
	} );
} );
