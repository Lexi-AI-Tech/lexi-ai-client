/**
 * Application constants and enums
 */

/**
 * Supported operating system types
 */
export enum SystemType {
  MAC = "mac",
  // WINDOWS = "windows", // Not yet supported
}

/**
 * Supported transcription language codes
 */
export enum LanguageCode {
  AUTO = "auto", // Auto-detect language
  EN = "en", // English
  ES = "es", // Spanish
  FR = "fr", // French
  DE = "de", // German
  IT = "it", // Italian
  PT = "pt", // Portuguese
  RU = "ru", // Russian
  JA = "ja", // Japanese
  KO = "ko", // Korean
  ZH = "zh", // Chinese
  AR = "ar", // Arabic
  HI = "hi", // Hindi
  NL = "nl", // Dutch
  PL = "pl", // Polish
  TR = "tr", // Turkish
  SV = "sv", // Swedish
  DA = "da", // Danish
  NO = "no", // Norwegian
  FI = "fi", // Finnish
}

/**
 * Get all language codes as an array of strings
 */
export function getAllLanguageCodes(): string[] {
  return Object.values(LanguageCode);
}

/**
 * Check if a language code is valid
 */
export function isValidLanguageCode(code: string): boolean {
  return Object.values(LanguageCode).includes(code as LanguageCode);
}

/**
 * Get all system types as an array of strings
 */
export function getAllSystemTypes(): string[] {
  return Object.values(SystemType);
}

/**
 * Check if a system type is valid
 */
export function isValidSystemType(type: string): boolean {
  return Object.values(SystemType).includes(type as SystemType);
}

/**
 * Language display names mapping
 */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  [LanguageCode.AUTO]: "Auto Detect Language",
  [LanguageCode.EN]: "English",
  [LanguageCode.ES]: "Spanish",
  [LanguageCode.FR]: "French",
  [LanguageCode.DE]: "German",
  [LanguageCode.IT]: "Italian",
  [LanguageCode.PT]: "Portuguese",
  [LanguageCode.RU]: "Russian",
  [LanguageCode.JA]: "Japanese",
  [LanguageCode.KO]: "Korean",
  [LanguageCode.ZH]: "Chinese",
  [LanguageCode.AR]: "Arabic",
  [LanguageCode.HI]: "Hindi",
  [LanguageCode.NL]: "Dutch",
  [LanguageCode.PL]: "Polish",
  [LanguageCode.TR]: "Turkish",
  [LanguageCode.SV]: "Swedish",
  [LanguageCode.DA]: "Danish",
  [LanguageCode.NO]: "Norwegian",
  [LanguageCode.FI]: "Finnish",
};

/**
 * Get language display name for a language code
 */
export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code as LanguageCode] || code;
}

