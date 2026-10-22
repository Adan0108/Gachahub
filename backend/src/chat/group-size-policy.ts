/**
 * Most people a group can hold, counting everyone entitled to a leaf (invitees included): the
 * creator plus the 99 a create or add request may name. The notification consumer accepts this
 * many recipients for one message, so a full group never loses its notifications.
 */
export const MAX_GROUP_MEMBERS = 100;

/** How many people one create or add request may name: everyone but the person sending it. */
export const MAX_MEMBERS_PER_REQUEST = MAX_GROUP_MEMBERS - 1;
