// Media and archives are already compressed: deflating them again costs most of the archiving
// time on a media-heavy site and saves almost nothing, so zip archives store them as they are.
const ALREADY_COMPRESSED_FILE =
	/\.(jpe?g|png|gif|webp|avif|heic|mp4|m4v|mov|webm|mp3|m4a|ogg|woff2?|zip|gz|tgz|bz2|xz|7z|rar|pdf)$/i;

export function isAlreadyCompressedFile( name: string ): boolean {
	return ALREADY_COMPRESSED_FILE.test( name );
}
