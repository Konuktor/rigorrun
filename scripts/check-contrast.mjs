#!/usr/bin/env node
/**
 * Verifies the design tokens against WCAG contrast requirements.
 *
 * The palette is derived from these numbers rather than chosen by eye, and this
 * script is what keeps it honest: it runs in the release gate, so a token that
 * drifts below its requirement fails the build rather than shipping.
 */
const hex = (h) =>
  h
    .replace('#', '')
    .match(/../g)
    .map((x) => parseInt(x, 16));

const relativeLuminance = (rgb) => {
  const a = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};

export const contrast = (a, b) => {
  const l1 = relativeLuminance(hex(a));
  const l2 = relativeLuminance(hex(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** Dark theme — the product surface. */
const DARK = {
  canvas: '#0B0D10',
  surface: '#101318',
  raised: '#161A20',
  overlay: '#1B2027',
  text: '#E9ECF1',
  textSecondary: '#B4BDCB',
  textMuted: '#939FAF',
  textDisabled: '#8792A2',
  success: '#4ADE80',
  danger: '#FF8080',
  warning: '#F0B72F',
  info: '#93B4FF',
};

/** Light theme — the Northstar demo application. */
const LIGHT = {
  canvas: '#F6F7F9',
  surface: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#41506A',
  textMuted: '#5A6880',
  brand: '#1D4ED8',
  successText: '#166534',
  warningText: '#854D0E',
  dangerText: '#9F1239',
  infoText: '#1E40AF',
};

/** Status pill foregrounds sit on tinted backgrounds, not on the page. */
const LIGHT_TINTS = {
  successBg: '#ECFDF5',
  warningBg: '#FEFCE8',
  dangerBg: '#FFF1F2',
  infoBg: '#EFF6FF',
  bannerBg: '#FEF3C7',
};

const checks = [];
const check = (label, fg, bg, need = 4.5) => {
  checks.push({ label, fg, bg, need, ratio: contrast(fg, bg) });
};

// Dark: every text token against every surface it can legitimately sit on.
for (const surface of ['canvas', 'surface', 'raised', 'overlay']) {
  for (const token of ['text', 'textSecondary', 'textMuted', 'textDisabled']) {
    check(`dark ${token} on ${surface}`, DARK[token], DARK[surface]);
  }
  for (const token of ['success', 'danger', 'warning', 'info']) {
    check(`dark ${token} on ${surface}`, DARK[token], DARK[surface]);
  }
}

// Light: the Northstar palette.
for (const surface of ['canvas', 'surface']) {
  for (const token of ['text', 'textSecondary', 'textMuted', 'brand']) {
    check(`light ${token} on ${surface}`, LIGHT[token], LIGHT[surface]);
  }
}
check('light success pill', LIGHT.successText, LIGHT_TINTS.successBg);
check('light warning pill', LIGHT.warningText, LIGHT_TINTS.warningBg);
check('light danger pill', LIGHT.dangerText, LIGHT_TINTS.dangerBg);
check('light info pill', LIGHT.infoText, LIGHT_TINTS.infoBg);
check('light banner', LIGHT.warningText, LIGHT_TINTS.bannerBg);

let failures = 0;
for (const c of checks) {
  const ok = c.ratio >= c.need;
  if (!ok) failures += 1;
  const line = `${ok ? 'pass' : 'FAIL'}  ${c.ratio.toFixed(2).padStart(6)}:1  (need ${c.need})  ${c.label}`;
  if (!ok || process.env['VERBOSE']) console.log(line);
}

console.log(
  `\n${checks.length - failures}/${checks.length} token pairs meet their contrast requirement.`,
);
if (failures > 0) {
  console.error(`${failures} contrast failure(s). Adjust the palette, not the requirement.`);
  process.exitCode = 1;
}
