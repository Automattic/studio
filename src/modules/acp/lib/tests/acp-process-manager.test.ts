/**
 * Tests for ACP Process Manager
 */

import { describe, it, expect } from 'vitest';
import { AcpProcessManager } from '../acp-process-manager';

type ParseResult = { command: string; args: string[] };
type AcpProcessManagerWithParse = AcpProcessManager & {
	parseCommandString: ( command: string ) => ParseResult;
};

function parseCommand( manager: AcpProcessManager, command: string ): ParseResult {
	return ( manager as unknown as AcpProcessManagerWithParse ).parseCommandString( command );
}

describe( 'AcpProcessManager', () => {
	describe( 'parseCommandString', () => {
		it( 'should parse simple command with args', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, 'ls -la' );

			expect( result ).toEqual( {
				command: 'ls',
				args: [ '-la' ],
			} );
		} );

		it( 'should parse command with multiple args', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, 'git commit -m message' );

			expect( result ).toEqual( {
				command: 'git',
				args: [ 'commit', '-m', 'message' ],
			} );
		} );

		it( 'should handle single-quoted strings', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, "echo 'hello world'" );

			expect( result ).toEqual( {
				command: 'echo',
				args: [ 'hello world' ],
			} );
		} );

		it( 'should handle double-quoted strings', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, 'echo "hello world"' );

			expect( result ).toEqual( {
				command: 'echo',
				args: [ 'hello world' ],
			} );
		} );

		it( 'should handle mixed quotes', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, `git commit -m 'fix bug'` );

			expect( result ).toEqual( {
				command: 'git',
				args: [ 'commit', '-m', 'fix bug' ],
			} );
		} );

		it( 'should handle escaped characters', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, 'echo hello\\ world' );

			expect( result ).toEqual( {
				command: 'echo',
				args: [ 'hello world' ],
			} );
		} );

		it( 'should handle command without args', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, 'pwd' );

			expect( result ).toEqual( {
				command: 'pwd',
				args: [],
			} );
		} );

		it( 'should handle complex git command', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, 'git commit -m "Add feature with \\"quotes\\""' );

			expect( result ).toEqual( {
				command: 'git',
				args: [ 'commit', '-m', 'Add feature with "quotes"' ],
			} );
		} );

		it( 'should handle empty string', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, '' );

			expect( result ).toEqual( {
				command: '',
				args: [],
			} );
		} );

		it( 'should handle file paths with spaces in quotes', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand( manager, 'cat "my file.txt"' );

			expect( result ).toEqual( {
				command: 'cat',
				args: [ 'my file.txt' ],
			} );
		} );

		it( 'should handle multiple arguments with various quoting', () => {
			const manager = new AcpProcessManager();
			const result = parseCommand(
				manager,
				`node script.js --input "file 1.txt" --output 'file 2.txt'`
			);

			expect( result ).toEqual( {
				command: 'node',
				args: [ 'script.js', '--input', 'file 1.txt', '--output', 'file 2.txt' ],
			} );
		} );
	} );
} );
