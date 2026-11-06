import React from 'react';
import { Image } from 'react-native';
export const C = {
  navy: '#11243A',
  coral: '#EF543F',
  mint: '#DDF1E8',
  green: '#177754',
  muted: '#72808D',
  paper: '#F5F7F8',
  line: '#E7ECEF',
  blue: '#496AF1',
};
// Approved NEXT STOP artwork (generated from assets/brand/next-stop-logo-source.png by
// scripts/generate-brand-assets.py). Proportions are preserved; never stretch these images.
const WORDMARK = require('../../assets/brand/next-stop-wordmark.png');
const SYMBOL = require('../../assets/brand/next-stop-symbol.png');
const WORDMARK_RATIO = 1200 / 409;

/** Compact mark: the coral N / location-pin symbol. */
export function Mark({ size = 42 }: { size?: number }) {
  return (
    <Image
      source={SYMBOL}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}
/** Full wordmark with tagline, for light backgrounds. */
export function Brand({ height = 54 }: { height?: number }) {
  return (
    <Image
      source={WORDMARK}
      style={{ height, width: height * WORDMARK_RATIO }}
      resizeMode="contain"
      accessible
      accessibilityRole="image"
      accessibilityLabel="NEXT STOP. Your ride. In sight."
    />
  );
}
