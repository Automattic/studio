/**
 * Tests for the MCP-to-pi content adapter.
 *
 * Covers the five MCP content variants — `text`, `image`, `audio`,
 * `resource` (text + binary), `resource_link` — and asserts the
 * mapping rules described in `content-adapter.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adaptMcpContent, adaptMcpContentBlock, type McpContentBlock } from '../content-adapter';

describe( 'adaptMcpContentBlock', () => {
	let warnSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	} );

	afterEach( () => {
		warnSpy.mockRestore();
	} );

	it( 'passes through text blocks unchanged', () => {
		expect( adaptMcpContentBlock( { type: 'text', text: 'hello' } ) ).toEqual( [
			{ type: 'text', text: 'hello' },
		] );
	} );

	it( 'passes through image blocks unchanged', () => {
		expect(
			adaptMcpContentBlock( {
				type: 'image',
				data: 'base64==',
				mimeType: 'image/png',
			} )
		).toEqual( [ { type: 'image', data: 'base64==', mimeType: 'image/png' } ] );
	} );

	it( 'flattens inline text resource blocks into a labelled text block', () => {
		const result = adaptMcpContentBlock( {
			type: 'resource',
			resource: {
				uri: 'file:///tmp/example.json',
				text: '{"key":"value"}',
				mimeType: 'application/json',
			},
		} );
		expect( result ).toEqual( [
			{
				type: 'text',
				text: '[resource file:///tmp/example.json]\n{"key":"value"}',
			},
		] );
	} );

	it( 'stubs out binary resource blocks with a pointer text block', () => {
		const result = adaptMcpContentBlock( {
			type: 'resource',
			resource: {
				uri: 'file:///tmp/example.bin',
				blob: 'BASE64',
				mimeType: 'application/octet-stream',
			},
		} );
		expect( result ).toEqual( [
			{
				type: 'text',
				text: '[resource file:///tmp/example.bin (binary, application/octet-stream)]',
			},
		] );
	} );

	it( 'serialises resource_link blocks to a text block with description', () => {
		const result = adaptMcpContentBlock( {
			type: 'resource_link',
			uri: 'https://example.com/post/1',
			description: 'A linked post',
		} );
		expect( result ).toEqual( [
			{
				type: 'text',
				text: '[resource_link https://example.com/post/1 — A linked post]',
			},
		] );
	} );

	it( 'omits the description suffix when missing', () => {
		const result = adaptMcpContentBlock( {
			type: 'resource_link',
			uri: 'https://example.com/post/1',
		} );
		expect( result ).toEqual( [
			{ type: 'text', text: '[resource_link https://example.com/post/1]' },
		] );
	} );

	it( 'drops audio blocks with a warning', () => {
		const result = adaptMcpContentBlock( {
			type: 'audio',
			data: 'base64',
			mimeType: 'audio/wav',
		} );
		expect( result ).toEqual( [] );
		expect( warnSpy ).toHaveBeenCalledWith(
			expect.stringContaining( 'unsupported MCP audio content block' )
		);
	} );

	it( 'drops unknown block types with a warning', () => {
		const result = adaptMcpContentBlock( {
			type: 'made-up',
			payload: 'something',
		} as McpContentBlock );
		expect( result ).toEqual( [] );
		expect( warnSpy ).toHaveBeenCalledWith(
			expect.stringContaining( 'unknown MCP content block of type "made-up"' )
		);
	} );
} );

describe( 'adaptMcpContent', () => {
	let warnSpy: ReturnType< typeof vi.spyOn >;
	beforeEach( () => {
		warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	} );
	afterEach( () => {
		warnSpy.mockRestore();
	} );

	it( 'flattens across blocks and drops unsupported types', () => {
		const result = adaptMcpContent( [
			{ type: 'text', text: 'a' },
			{ type: 'audio', data: '', mimeType: 'audio/wav' },
			{
				type: 'image',
				data: 'b',
				mimeType: 'image/jpeg',
			},
		] );
		expect( result ).toEqual( [
			{ type: 'text', text: 'a' },
			{ type: 'image', data: 'b', mimeType: 'image/jpeg' },
		] );
	} );
} );
