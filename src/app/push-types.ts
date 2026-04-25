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
  "sms_changed",
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

function hasStringValue(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function summarizeUnknownPush(fullPush: unknown): Record<string, unknown> | undefined {
  if (!fullPush || typeof fullPush !== "object") {
    return undefined;
  }

  const push = fullPush as Record<string, unknown>;
  return {
    iden: push.iden,
    type: push.type,
    encrypted: !!push.encrypted,
    contentFlags: {
      heading: hasStringValue(push.title),
      message: hasStringValue(push.body),
      link: hasStringValue(push.url),
      fileLink: hasStringValue(push.file_url),
      imageLink: hasStringValue(push.image_url),
      ciphertext: hasStringValue(push.ciphertext),
    },
    notificationsCount: Array.isArray(push.notifications)
      ? push.notifications.length
      : 0,
    created: push.created,
    modified: push.modified,
  };
}

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
      pushSummary: summarizeUnknownPush(fullPush),
    });
  }
}
