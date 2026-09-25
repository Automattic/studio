import { describe, expect, it } from 'vitest';
import { importFailureReason } from '../import-failure-reason';
import type { ImportResponse } from '@studio/common/types/sync';

describe( 'importFailureReason', () => {
	it( 'joins the API error with the VaultPress restore message', () => {
		const status: ImportResponse = {
			status: 'failed',
			success: false,
			error: 'Import failed',
			error_data: {
				vp_restore_status: 'failed',
				vp_restore_message: 'Site is not registered with Jetpack Backup',
				vp_rewind_id: null,
			},
		};
		expect( importFailureReason( status ) ).toBe(
			'Import failed — Site is not registered with Jetpack Backup'
		);
	} );

	it( 'skips empty parts and trims the rest', () => {
		const status: ImportResponse = {
			status: 'failed',
			success: false,
			error: '  Database failed to import  ',
			error_data: { vp_restore_status: null, vp_restore_message: '', vp_rewind_id: null },
		};
		expect( importFailureReason( status ) ).toBe( 'Database failed to import' );
	} );

	it( 'returns an empty string when the API gave no reason', () => {
		const status: ImportResponse = {
			status: 'failed',
			success: false,
			error: '',
			error_data: null,
		};
		expect( importFailureReason( status ) ).toBe( '' );
	} );

	it( 'returns an empty string for a non-failed status', () => {
		const status: ImportResponse = {
			status: 'archive_import_started',
			success: true,
			backup_progress: 100,
			import_progress: 10,
		};
		expect( importFailureReason( status ) ).toBe( '' );
	} );
} );
