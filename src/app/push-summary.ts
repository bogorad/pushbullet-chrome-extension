export interface SafePushSummary {
  iden: unknown;
  type: unknown;
  encrypted: boolean;
  contentFlags: {
    heading: boolean;
    message: boolean;
    link: boolean;
    fileLink: boolean;
    imageLink: boolean;
    ciphertext: boolean;
  };
  notificationsCount: number;
  created: unknown;
  modified: unknown;
}

function hasStringValue(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

export function summarizePushForLog(push: unknown): SafePushSummary | undefined {
  if (!push || typeof push !== "object") {
    return undefined;
  }

  const pushRecord = push as Record<string, unknown>;
  const notifications = Array.isArray(pushRecord.notifications)
    ? pushRecord.notifications
    : [];

  return {
    iden: pushRecord.iden,
    type: pushRecord.type,
    encrypted: !!pushRecord.encrypted,
    contentFlags: {
      heading: hasStringValue(pushRecord.title),
      message: hasStringValue(pushRecord.body),
      link: hasStringValue(pushRecord.url),
      fileLink: hasStringValue(pushRecord.file_url),
      imageLink: hasStringValue(pushRecord.image_url),
      ciphertext: hasStringValue(pushRecord.ciphertext),
    },
    notificationsCount: notifications.length,
    created: pushRecord.created,
    modified: pushRecord.modified,
  };
}
