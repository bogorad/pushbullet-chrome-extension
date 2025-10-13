/**
 * Push Type Support Module
 * Centralizes logic for checking which push types are supported.
 */

import { debugLogger } from "../lib/logging";

/**
 * Push types that are fully supported and can be displayed in the extension.
 */
export const SUPPORTED_PUSH_TYPES: readonly string[] = [
  "note",
  "link",
  "mirror",
  "smschanged",
  "file",
] as const;

/**
 * Push types that are known but explicitly not supported.
 */
export const KNOWN_UNSUPPORTED_TYPES: readonly string[] = [
  "dismissal",
  "clip",
  "ephemeral",
  "channel",
] as const;

/**
 * Result of checking push type support.
 */
export interface PushTypeSupportResult {
  supported: boolean;
  category: "supported" | "known-unsupported" | "unknown";
}

/**
 * Check if a push type is supported by the extension.
 */
export function checkPushTypeSupport(pushType: string): PushTypeSupportResult {
  if (SUPPORTED_PUSH_TYPES.includes(pushType)) {
    return { supported: true, category: "supported" };
  }

  if (KNOWN_UNSUPPORTED_TYPES.includes(pushType)) {
    return { supported: false, category: "known-unsupported" };
  }

  return { supported: false, category: "unknown" };
}

/**
 * Log a warning for an unsupported push type.
 *
 * @param pushType - The type of the push
 * @param pushIden - The push identifier
 * @param source - Where the push was encountered (e.g., 'fetchRecentPushes', 'websocket')
 * @param fullPush - Optional full push data for unknown types
 */
export function logUnsupportedPushType(
  pushType: string,
  pushIden: string,
  source: string,
  fullPush?: any,
): void {
  const typeCheck = checkPushTypeSupport(pushType);

  if (typeCheck.category === "known-unsupported") {
    debugLogger.general("WARN", "Encountered known unsupported push type", {
      pushType,
      pushIden,
      source,
      category: typeCheck.category,
      reason: "This push type is not supported by the extension",
      supportedTypes: SUPPORTED_PUSH_TYPES,
    });
  } else if (typeCheck.category === "unknown") {
    debugLogger.general("WARN", "Encountered unknown push type", {
      pushType,
      pushIden,
      source,
      category: typeCheck.category,
      reason: "This is a new or unrecognized push type",
      supportedTypes: SUPPORTED_PUSH_TYPES,
      // Include full push data for unknown types
      fullPushData: fullPush,
    });
  }
}