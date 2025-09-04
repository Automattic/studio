/**
 * Custom webpack loader to fix import.meta.dirname in specific packages
 * 
 * This loader targets @php-wasm/node and @wp-playground/cli worker threads
 * to replace import.meta.dirname (which becomes undefined when bundled by webpack)
 * with the correct path for ASAR archives.
 * 
 * This is necessary because @php-wasm/node uses import.meta.dirname to locate
 * ICU data files (like icudt74l.dat), and when the app is packaged in an ASAR
 * archive, these paths need to point to the correct location within the archive.
 */

const path = require('path');

module.exports = function fixImportMetaDirnameLoader(source) {
	// Only apply to specific files that need the fix
	const shouldApplyFix = 
		this.resourcePath.includes('@php-wasm/node') ||
		this.resourcePath.includes('worker-thread-v1') ||
		this.resourcePath.includes('worker-thread-v2');
	
	if (!shouldApplyFix) {
		return source;
	}

	// Check if we're in production mode
	const isProduction = this.mode === 'production';
	
	// Replace import.meta.dirname with the appropriate path
	// In production: use process.resourcesPath to find the ASAR archive
	// In development: use the absolute path to .webpack/main
	const replacement = isProduction
		? 'require("path").join(process.resourcesPath, "app.asar", ".webpack", "main")'
		: JSON.stringify(path.resolve(__dirname, '..', '.webpack', 'main'));
	
	// Replace all occurrences of import.meta.dirname
	const modifiedSource = source.replace(/import\.meta\.dirname/g, replacement);
	
	// Also handle import.meta.filename if present
	const filenameReplacement = isProduction
		? 'require("path").join(process.resourcesPath, "app.asar", ".webpack", "main", "index.js")'
		: JSON.stringify(path.resolve(__dirname, '..', '.webpack', 'main', 'index.js'));
	
	const finalSource = modifiedSource.replace(/import\.meta\.filename/g, filenameReplacement);
	
	return finalSource;
};