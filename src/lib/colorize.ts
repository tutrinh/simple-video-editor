import type { ColorizeSettings } from "../domain/types";
import type { Rgb } from "./grade";

/** Neutral creative defaults used when Colorize is enabled for the first time. */
export const DEFAULT_COLORIZE: ColorizeSettings = {
  shadowColor: "#75c9ff",
  highlightColor: "#ffabd8",
  intensity: 35,
};

export const COLORIZE_PRESETS: ReadonlyArray<{ name: string; value: ColorizeSettings }> = [
  { name: "Cotton Candy", value: DEFAULT_COLORIZE },
  {
    name: "Light Blue",
    value: { shadowColor: "#65bfff", highlightColor: "#d8f3ff", intensity: 32 },
  },
  {
    name: "Teal & Orange",
    value: { shadowColor: "#167c80", highlightColor: "#f2a65a", intensity: 30 },
  },
  {
    name: "Cool / Warm",
    value: { shadowColor: "#506fa5", highlightColor: "#f3c481", intensity: 25 },
  },
  {
    name: "Golden Hour",
    value: { shadowColor: "#704737", highlightColor: "#ffd08a", intensity: 25 },
  },
  {
    name: "Moonlight",
    value: { shadowColor: "#263f70", highlightColor: "#a8d8f0", intensity: 32 },
  },
  {
    name: "Green Muted",
    value: { shadowColor: "#486a59", highlightColor: "#c8c39d", intensity: 20 },
  },
  {
    name: "Rose Gold",
    value: { shadowColor: "#76566f", highlightColor: "#f3bcaf", intensity: 24 },
  },
  {
    name: "Lavender Dream",
    value: { shadowColor: "#625a91", highlightColor: "#e5c7f4", intensity: 28 },
  },
  {
    name: "Vintage Sepia",
    value: { shadowColor: "#594638", highlightColor: "#e2c08c", intensity: 25 },
  },
  {
    name: "Cyberpunk",
    value: { shadowColor: "#173e78", highlightColor: "#f044b7", intensity: 42 },
  },
  {
    name: "Arctic Clean",
    value: { shadowColor: "#357aa0", highlightColor: "#ddf7ff", intensity: 18 },
  },
];

const HEX = /^#?([0-9a-f]{6})$/i;

export function colorizeRgb(hex: string, fallback: string): Rgb {
  const match = (hex || fallback).match(HEX) ?? fallback.match(HEX);
  const value = Number.parseInt(match?.[1] ?? "000000", 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function normalizeColorize(value?: Partial<ColorizeSettings>): ColorizeSettings {
  const shadowColor = value?.shadowColor ?? "";
  const highlightColor = value?.highlightColor ?? "";
  return {
    shadowColor: HEX.test(shadowColor) ? shadowColor : DEFAULT_COLORIZE.shadowColor,
    highlightColor: HEX.test(highlightColor) ? highlightColor : DEFAULT_COLORIZE.highlightColor,
    intensity: Math.max(0, Math.min(100, Number(value?.intensity) || 0)),
  };
}
