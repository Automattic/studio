import { serializePlugins } from '../serialize-plugins';

describe( 'serializePlugins', () => {
	it( 'should correctly serialize an empty array', () => {
		const result = serializePlugins( [] );
		expect( result ).toBe( 'a:0:{}' );
	} );

	it( 'should correctly serialize an array with one plugin', () => {
		const result = serializePlugins( [ 'hello-dolly' ] );
		expect( result ).toBe( 'a:1:{i:0;s:11:"hello-dolly";}' );
	} );

	it( 'should correctly serialize an array with multiple plugins', () => {
		const plugins = [ 'akismet', 'jetpack', 'woocommerce', 'classc-editor' ];
		const result = serializePlugins( plugins );
		expect( result ).toBe(
			'a:4:{i:0;s:7:"akismet";i:1;s:7:"jetpack";i:2;s:11:"woocommerce";i:3;s:13:"classc-editor";}'
		);
	} );
} );
