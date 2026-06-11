import { describe, expect, it } from 'vitest';
import { entriesToRenderItems } from './index';
import type { SessionEntry } from '@/data/core';

describe( 'entriesToRenderItems', () => {
	it( 'renders image attachments from the user prompt entry thumbnails', () => {
		const items = entriesToRenderItems( [
			{
				type: 'custom',
				id: 'prompt',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.000Z',
				customType: 'studio.user_prompt',
				data: {
					text: 'Use this logo',
					source: 'prompt',
					attachments: [
						{
							kind: 'image',
							id: 'image-1',
							name: 'logo.png',
							mimeType: 'image/png',
							size: 123,
							width: 80,
							height: 40,
							previewDataUrl: 'data:image/png;base64,abc123',
						},
					],
				},
			},
		] as SessionEntry[] );

		expect( items ).toMatchObject( [
			{
				kind: 'user-turn',
				text: 'Use this logo',
				attachments: [
					{
						id: 'image-1',
						name: 'logo.png',
						src: 'data:image/png;base64,abc123',
					},
				],
			},
		] );
	} );

	it( 'falls back to a src-less chip when the attachment has no thumbnail', () => {
		const items = entriesToRenderItems( [
			{
				type: 'custom',
				id: 'prompt',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.000Z',
				customType: 'studio.user_prompt',
				data: {
					text: 'Use this logo',
					source: 'prompt',
					attachments: [
						{
							id: 'image-1',
							name: 'logo.png',
							mimeType: 'image/png',
							size: 123,
						},
						{
							kind: 'file',
							name: 'notes.txt',
							size: 12,
						},
					],
				},
			},
		] as SessionEntry[] );

		expect( items ).toMatchObject( [
			{
				kind: 'user-turn',
				text: 'Use this logo',
				attachments: [ { id: 'image-1', name: 'logo.png', src: undefined } ],
			},
		] );
	} );
} );
