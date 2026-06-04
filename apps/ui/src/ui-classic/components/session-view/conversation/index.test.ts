import { describe, expect, it } from 'vitest';
import { entriesToRenderItems } from './index';
import type { SessionEntry } from '@/data/core';

describe( 'entriesToRenderItems', () => {
	it( 'attaches image previews to the matching user prompt', () => {
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
							width: 80,
							height: 40,
						},
					],
				},
			},
			{
				type: 'message',
				id: 'user',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.001Z',
				message: {
					role: 'user',
					content: [
						{ type: 'text', text: 'Use this logo' },
						{ type: 'image', data: 'abc123', mimeType: 'image/png' },
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
} );
