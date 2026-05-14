import type { ComponentType, SVGProps } from "react";
import {
  CN,
  DE,
  DK,
  ES,
  FI,
  FR,
  IN,
  IT,
  JP,
  KR,
  NL,
  NO,
  PL,
  PT,
  RU,
  SA,
  SE,
  TR,
  US,
} from "country-flag-icons/react/3x2";

type FlagComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** ISO 639-1-ish app codes → flag components (bundled SVGs, consistent on all OS). */
const LANGUAGE_FLAG_COMPONENT: Record<string, FlagComponent> = {
  en: US,
  es: ES,
  fr: FR,
  de: DE,
  it: IT,
  pt: PT,
  ru: RU,
  ja: JP,
  ko: KR,
  zh: CN,
  ar: SA,
  hi: IN,
  nl: NL,
  pl: PL,
  tr: TR,
  sv: SE,
  da: DK,
  no: NO,
  fi: FI,
};

export type LanguageFlagIconProps = {
  languageCode: string;
  className?: string;
};

export function LanguageFlagIcon({
  languageCode,
  className = "lang-flag",
}: LanguageFlagIconProps) {
  const c = (languageCode || "").trim().toLowerCase();
  if (!c || c === "auto") return null;
  const Flag = LANGUAGE_FLAG_COMPONENT[c];
  if (!Flag) return null;
  return (
    <span className={className} aria-hidden>
      <Flag />
    </span>
  );
}
