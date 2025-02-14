import path from 'path';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import { PHP } from '@php-wasm/universal';
import fs from 'fs-extra';

export async function geWpConfigConstants( projectPath: string ) {
	const wpConfigPath = path.join( projectPath, 'wp-config.php' );
	if ( ! fs.existsSync( wpConfigPath ) ) {
		// Necessary when creating a new project
		return { WP_SITEURL: '', WP_HOME: '' };
	}

	const id = await loadNodeRuntime( '8.3' );
	const php = new PHP( id );
	php.mkdir( '/var/www' );
	php.chdir( '/var/www' );
	php.mount( '/var/www/', createNodeFsMountHandler( path.dirname( wpConfigPath ) ) );
	const { json } = await php.run( {
		code: `<?php
		require_once '/var/www/wp-config.php';
		
		function studioGetSafeConstant( $name ) {
			return defined( $name ) ? constant( $name ) : '';
		}

		echo json_encode( array(
			'WP_SITEURL' => studioGetSafeConstant( 'WP_SITEURL' ),
			'WP_HOME' => studioGetSafeConstant( 'WP_HOME' ),
		) );
		?>`,
	} );
	php.exit();
	return json as { WP_SITEURL: string; WP_HOME: string };
}
