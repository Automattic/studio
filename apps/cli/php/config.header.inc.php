<?php declare(strict_types = 1);

if (defined('STUDIO_DATABASE_ENABLED') && STUDIO_DATABASE_ENABLED !== true) {
    return;
}

$studio_stylesheet_direction = ($GLOBALS['text_dir'] ?? 'ltr') === 'rtl' ? '.rtl' : '';
$studio_stylesheet_version = rawurlencode(\PhpMyAdmin\Version::VERSION);
?>
<link rel="stylesheet" type="text/css" href="themes/studio<?= $studio_stylesheet_direction ?>.css?<?= $studio_stylesheet_version ?>">
