/**
 * Who may view which kind of file.
 *
 * One table, one function. Every access decision in the app goes through
 * `canViewFile` so the rule cannot drift between the API route, the UI and
 * whatever phase 4 and 5 add.
 *
 * Pure and dependency-free, so it is directly unit testable.
 */

import { can, type Principal } from "../auth/permissions";

export type FileKindName =
  | "ID_FRONT"
  | "ID_BACK"
  | "SELFIE"
  | "REQUEST_PHOTO"
  | "EQUIPMENT_PHOTO";

/**
 * Identity documents. These are the most sensitive data in the system.
 *
 * NOT viewable by their own owner either. Once an ID is uploaded the customer
 * only ever sees "uploaded" - there is no legitimate reason to serve the scan
 * back to the browser, and every time we do is another chance for it to be
 * cached, screenshotted or intercepted.
 */
export const ID_DOCUMENT_KINDS: readonly FileKindName[] = [
  "ID_FRONT",
  "ID_BACK",
  "SELFIE",
];

export function isIdDocument(kind: FileKindName): boolean {
  return ID_DOCUMENT_KINDS.includes(kind);
}

export interface FileAccessSubject {
  /** The signed-in user, or null when anonymous. */
  viewer: (Principal & { id: string }) | null;
  /** Owner of the file. Null when the owning account was removed. */
  ownerId: string | null;
  kind: FileKindName;
}

export type AccessDecision =
  | { allowed: true; /** True when the view must be written to AuditLog first. */ mustAudit: boolean }
  | { allowed: false; reason: "ANONYMOUS" | "FORBIDDEN" };

export function canViewFile({
  viewer,
  ownerId,
  kind,
}: FileAccessSubject): AccessDecision {
  if (!viewer) return { allowed: false, reason: "ANONYMOUS" };

  if (isIdDocument(kind)) {
    // SUPER_ADMIN only, and always audited - including when the viewer
    // happens to also be the owner.
    if (can(viewer, "viewIdDocuments")) return { allowed: true, mustAudit: true };
    return { allowed: false, reason: "FORBIDDEN" };
  }

  // Request and equipment photos: the owner, plus the admins who need them to
  // do dispatch. A dispatcher must be able to see the damaged car.
  if (ownerId !== null && viewer.id === ownerId) {
    return { allowed: true, mustAudit: false };
  }

  if (can(viewer, "viewAllRequests") || can(viewer, "viewProviders")) {
    return { allowed: true, mustAudit: false };
  }

  return { allowed: false, reason: "FORBIDDEN" };
}

/**
 * Which kinds a given user is allowed to upload.
 *
 * Any signed-in user may upload any of them today: a customer uploads an ID
 * and request photos, an applicant uploads ID plus equipment photos, and the
 * forms that consume them (phases 3 and 4) decide which are required.
 * Attachment is what gives a file meaning; an unattached upload is deleted
 * within ORPHAN_FILE_TTL_HOURS.
 */
export function canUploadKind(
  viewer: (Principal & { id: string }) | null,
  kind: FileKindName,
): boolean {
  if (viewer === null) return false;
  return UPLOADABLE_KINDS.includes(kind);
}

/**
 * Every kind is uploadable today. Listed explicitly rather than assumed, so
 * that restricting one later (say, EQUIPMENT_PHOTO to approved providers
 * only) is a change here and nowhere else.
 */
const UPLOADABLE_KINDS: readonly FileKindName[] = [
  "ID_FRONT",
  "ID_BACK",
  "SELFIE",
  "REQUEST_PHOTO",
  "EQUIPMENT_PHOTO",
];
