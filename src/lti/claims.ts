/**
 * LTI 1.3 claim URIs and vocabularies.
 *
 * Written out rather than pulled from a library because these strings are the
 * contract with the platform. A typo here produces a launch that fails with a
 * generic error on the platform side, which is among the least debuggable
 * situations in this protocol.
 */

const LTI = "https://purl.imsglobal.org/spec/lti/claim";
const DL = "https://purl.imsglobal.org/spec/lti-dl/claim";
const AGS = "https://purl.imsglobal.org/spec/lti-ags/claim";
const NRPS = "https://purl.imsglobal.org/spec/lti-nrps/claim";

export const CLAIM = {
  messageType: `${LTI}/message_type`,
  version: `${LTI}/version`,
  deploymentId: `${LTI}/deployment_id`,
  targetLinkUri: `${LTI}/target_link_uri`,
  resourceLink: `${LTI}/resource_link`,
  roles: `${LTI}/roles`,
  context: `${LTI}/context`,
  custom: `${LTI}/custom`,
  lis: `${LTI}/lis`,
  launchPresentation: `${LTI}/launch_presentation`,
  toolPlatform: `${LTI}/tool_platform`,
  deepLinkingSettings: `${DL}/deep_linking_settings`,
  contentItems: `${DL}/content_items`,
  data: `${DL}/data`,
  endpoint: `${AGS}/endpoint`,
  namesRoleService: `${NRPS}/namesroleservice`,
} as const;

export const MESSAGE_TYPE = {
  resourceLink: "LtiResourceLinkRequest",
  deepLinking: "LtiDeepLinkingRequest",
  deepLinkingResponse: "LtiDeepLinkingResponse",
} as const;

/**
 * Role URIs come in institution and membership flavours and platforms differ in
 * which they send, so matching is on the suffix. An unrecognised role resolves
 * to the least privileged option, never the most.
 */
export type Role = "instructor" | "learner" | "administrator" | "mentor" | "unknown";

export function resolveRole(roles: unknown): Role {
  const list = Array.isArray(roles) ? roles.map(String) : [];
  const has = (suffix: string) =>
    list.some((role) => role.endsWith(`#${suffix}`) || role === suffix);

  // Order matters: a user holding both is treated as the more privileged, but
  // only among roles we actually recognise.
  if (has("Administrator")) return "administrator";
  if (has("Instructor") || has("TeachingAssistant")) return "instructor";
  if (has("Mentor")) return "mentor";
  if (has("Learner") || has("Student")) return "learner";
  return "unknown";
}

export function canGrade(role: Role): boolean {
  return role === "instructor" || role === "administrator";
}

/** AGS scopes. Requested at token time and checked against what is granted. */
export const SCOPE = {
  lineItem: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
  lineItemReadonly: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
  resultReadonly: "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
  score: "https://purl.imsglobal.org/spec/lti-ags/scope/score",
  contextMembershipReadonly:
    "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly",
} as const;

export const ACTIVITY_PROGRESS = [
  "Initialized", "Started", "InProgress", "Submitted", "Completed",
] as const;

/**
 * A score is only shown as final when gradingProgress is FullyGraded. Sending
 * Pending, or omitting the field and relying on a default, produces the most
 * common symptom in this entire protocol: a request that succeeded and a grade
 * that never appeared.
 */
export const GRADING_PROGRESS = [
  "NotReady", "Failed", "Pending", "PendingManual", "FullyGraded",
] as const;

export type ActivityProgress = (typeof ACTIVITY_PROGRESS)[number];
export type GradingProgress = (typeof GRADING_PROGRESS)[number];
