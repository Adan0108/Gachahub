# Migrations index

Apply with `prisma migrate deploy` only. Never rename, edit or squash an applied migration. Add a new folder.

## Base
- `20260622100010_init`: initial schema
- `20260622103738_init_better_auth`: auth tables

## Games and roles
- `20260706071937_add_games_and_game_categories`: games and categories
- `20260706081054_add_roles_and_game_moderators`: roles, game moderators

## Posts, comments, follows, interests
- `20260722101130_add_post_mvp`: posts
- `20260805081233_add_post_like_reaction`: post likes
- `20260810040243_add_comments`, `20260810041235_add_comments_replies`: comments and replies
- `20260813044344_add_user_follows`: follows
- `20260820125225_add_index_in_post_for_feed_feature`: feed index
- `20260903060446_add_user_interests`: user interests
- `20260903061830_restore_chat_schema_after_user_interest`: restores chat tables

## Chat (plain)
- `20260713113000_add_user_to_user_chat`: direct chat
- `20260722120000_add_chat_message_reactions`, `20260727082500_add_raw_emoji_reactions`: reactions
- `20260724035031_add_chat_user_blocks`: user blocks
- `20260727034919_add_chat_emotes`, `20260805093000_add_global_emote_shortcode_unique`, `20260805101500_cascade_reactions_on_emote_delete`: emotes
- `20260727073100_add_chat_conversation_pin`: pinned conversations
- `20260810120000_add_chat_participant_deleted_at`: per-user delete
- `20260812132437_add_message_request_setting`: who may message you
- `20260818155237_add_chat_notification_level`: notification level

## Media
- `20260728061142_add_shared_media_uploads`: shared uploads table
- `20260803050453_rename_media_updated_at_to_uploaded_at`, `20260821090000_add_media_upload_updated_at`: timestamps
- `20260820134224_add_media_cleanup_state`: cleanup state
- `20260914060000_add_chat_message_media`: media on chat messages
- `20260914073000_add_media_release_failed_status`: release-failed status
- `20260925150000_media_upload_opaque_kind`: encrypted blob and thumbnail kind

## Notifications
- `20260914050653_add_notifications`: notifications

## MLS encryption
- `20260915025906_add_mls_devices_and_key_packages`: devices, key packages
- `20260915040815_add_mls_handshakes_and_welcomes`: commit log, Welcomes
- `20260917030709_mls_handshake_sender_device_set_null`: keep handshakes when a device is deleted
- `20260917033241_mls_key_package_expires_at_index`: key package expiry index
- `20260921100000_add_mls_group_membership`: group roster
- `20260922100000_mls_membership_work_lease`: lease for membership work
- `20260922110000_add_mls_commit_faults`: refused-commit reports
- `20260922130000_link_session_to_chat_device`: session to device link
- `20260922140000_add_mls_group_infos`: published GroupInfo for external joins
- `20260925120000_mls_welcomes_conversation_idx`, `20260925120100_mls_group_members_device_removed_idx`, `20260925120200_drop_mls_group_members_device_idx`: index changes
- `20260925140000_chat_participants_pending_since`, `20260925140100_chat_participants_pending_since_idx`: invite age for expiry

## Encrypted history backup
- `20260925130000_chat_history_backup`: backup key and blobs
- `20260926100000_chat_backup_scheduled_deletion`: scheduled deletion date

## User search
- `20260925150100_pg_trgm_extension`: pg_trgm extension
- `20260925150200_user_name_trgm_idx`: trigram index on user name
