<?php

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/Encoding/compat-utf8.php';
require_once __DIR__ . '/Encoding/utf8.php';
require_once __DIR__ . '/Encoding/utf8-encoder.php';
require_once __DIR__ . '/DataLiberation/URL/functions.php';

if ( ! class_exists( '\Normalizer', false ) ) {
	require_once __DIR__ . '/DataLiberation/vendor-patched/symfony/polyfill-intl-normalizer/Normalizer.php';
	require_once __DIR__ . '/DataLiberation/vendor-patched/symfony/polyfill-intl-normalizer/Resources/stubs/Normalizer.php';
}

require_once __DIR__ . '/DataLiberation/vendor-patched/symfony/polyfill-intl-normalizer/bootstrap.php';
require_once __DIR__ . '/DataLiberation/vendor-patched/symfony/polyfill-ctype/bootstrap.php';
require_once __DIR__ . '/DataLiberation/vendor-patched/symfony/polyfill-php80/bootstrap.php';
