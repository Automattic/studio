<?php declare(strict_types = 1);

if (defined('STUDIO_DATABASE_ENABLED') && STUDIO_DATABASE_ENABLED !== true) {
    return;
}

$studio_stylesheet_direction = ($GLOBALS['text_dir'] ?? 'ltr') === 'rtl' ? '.rtl' : '';
$studio_stylesheet_path = __DIR__ . "/themes/studio{$studio_stylesheet_direction}.css";
$studio_stylesheet_version = is_file($studio_stylesheet_path)
    ? filemtime($studio_stylesheet_path)
    : \PhpMyAdmin\Version::VERSION;
?>
<style>
html {
    font-size: 87.5%;
}
</style>
<link rel="stylesheet" type="text/css" href="themes/studio<?= $studio_stylesheet_direction ?>.css?<?= rawurlencode((string) $studio_stylesheet_version) ?>">
