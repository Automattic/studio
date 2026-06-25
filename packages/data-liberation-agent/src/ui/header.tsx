import React from 'react';
import { Box, Text } from 'ink';

// Open lock in block characters (8 rows to match WP logo height)
const lock = [
  '     ▄████▄',
  '    ██    ██ ',
  '    ██    ██ ',
  '    ██      ',
  '  ▐██████████▌',
  '  ▐████▀▀████▌',
  '  ▐████  ████▌',
  '  ▝▀▀▀▀▀▀▀▀▀▀▘',
];

// Arrow between lock and WP logo
const arrow = [
  '          ',
  '  ➔       ',
  ' ➔   ➔    ',
  '   ➔   ➔  ',
  '    ➔     ',
  ' ➔    ➔   ',
  '   ➔      ',
  '          ',
];

// WordPress logo in block characters (from Studio CLI)
const wpLogo = [
  '    ▄█▛▀▀▀▀█▙▖',
  ' ▗▟█        ▗██▄',
  '▄███▛ ▝▜██  ▝███▙',
  '█ ▐█▙   ███  ▐█ ▐',
  '█  ▀█▄  ███▌ ▐▛ ▐',
  '▀▙▖ ▜█▄▟ ▝█▙▄▌ ▄▛',
  ' ▝▜▄▝██▌  ▀██▗▟▀',
  '    ▀██▙▄▄▄█▛▘',
];

export function Header({ subtitle }: { subtitle?: string }) {
  const info = [
    '',
    '',
    'data-liberation v0.1.0',
    subtitle || '',
    '',
  ];

  const infoGap = 3;
  const infoStartRow = Math.max(0, Math.floor((wpLogo.length - info.length) / 2));

  return (
    <Box flexDirection="column" marginBottom={1}>
      {wpLogo.map((wpLine, i) => {
        const infoIndex = i - infoStartRow;
        const infoLine = infoIndex >= 0 && infoIndex < info.length ? info[infoIndex] : '';
        const lockPadded = (lock[i] || '').padEnd(15);
        const arrowLine = arrow[i] || '                  ';
        return (
          <Text key={i}>
            <Text color="yellow">{lockPadded}</Text>
            <Text dimColor>{arrowLine}</Text>
            <Text color="blue">{wpLine}</Text>
            {' '.repeat(infoGap)}
            {infoLine === info[2] ? (
              <>
                <Text bold>data-liberation</Text>
                <Text dimColor> v0.1.0</Text>
              </>
            ) : infoLine ? (
              <Text dimColor>{infoLine}</Text>
            ) : null}
          </Text>
        );
      })}
    </Box>
  );
}
