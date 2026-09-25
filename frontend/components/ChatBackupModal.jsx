"use client";

import { useState } from "react";
import { FiCopy, FiX } from "react-icons/fi";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { formatDeletionDate, recoveryKeyMessage } from "../lib/backup/backupDeletion";
import { formatBytes } from "../lib/mls/media/attachmentView";

const MONO = { fontFamily: "monospace", wordBreak: "break-all", userSelect: "all" };

function SaveKeyStep({ pendingKey, confirmEnable, onCancel }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pendingKey.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="group-member-list">
      <small>
        This is your recovery key. It is shown only once. Without it, nobody can read your backed-up
        history, not even us, and it cannot be reset. Keep it somewhere safe, like a password manager.
      </small>
      <p style={MONO}>
        <b>{pendingKey.text}</b>
      </p>
      <button onClick={copy} type="button">
        <FiCopy /> {copied ? "Copied" : "Copy key"}
      </button>
      <label>
        <input checked={saved} onChange={(event) => setSaved(event.target.checked)} type="checkbox" />{" "}
        I saved my recovery key
      </label>
      {confirmEnable.error && (
        <small className="post-action-error">Couldn&apos;t turn on backup. Try again.</small>
      )}
      <div className="group-settings-footer">
        <button
          disabled={!saved || confirmEnable.isPending}
          onClick={() => confirmEnable.mutate()}
          type="button"
        >
          {confirmEnable.isPending ? "Turning on..." : "Turn on backup"}
        </button>
        <button className="device-cancel" disabled={confirmEnable.isPending} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Warns that deletion is scheduled; cancelling needs the recovery key unless this device holds it. */
function DeletionBanner({ backup, holdsKey }) {
  const [text, setText] = useState("");
  const { cancelDeletion } = backup;
  const date = formatDeletionDate(backup.status.data.deletionScheduledFor);
  if (!date) return null;

  const cancel = () => cancelDeletion.mutate(holdsKey ? undefined : text);

  return (
    <div className="group-member-list" role="alert">
      <small className="post-action-error">
        <b>Deletion scheduled for {date}.</b> Your backup will be deleted then. It keeps working until
        then.
      </small>
      {!holdsKey && (
        <input
          aria-label="Recovery key to cancel deletion"
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          placeholder="Recovery key"
          spellCheck={false}
          style={MONO}
          value={text}
        />
      )}
      {cancelDeletion.error && (
        <small className="post-action-error">
          {recoveryKeyMessage(cancelDeletion.error, "Couldn't cancel. Try again.")}
        </small>
      )}
      <div className="group-settings-footer">
        <button
          disabled={cancelDeletion.isPending || (!holdsKey && !text.trim())}
          onClick={cancel}
          type="button"
        >
          {cancelDeletion.isPending ? "Cancelling..." : "Cancel deletion"}
        </button>
      </div>
      {!holdsKey && <small>Without the recovery key you can only wait.</small>}
    </div>
  );
}

/** For a device without the key: deletion can only be scheduled, not done at once. */
function ScheduleDeletion({ backup }) {
  const [confirming, setConfirming] = useState(false);
  const { scheduleDeletion } = backup;
  if (backup.status.data.deletionScheduledFor) return null;

  return (
    <div className="group-settings-footer">
      {scheduleDeletion.error && (
        <small className="post-action-error">Couldn&apos;t schedule deletion.</small>
      )}
      {confirming ? (
        <>
          <small>
            Delete your backup in 7 days? You can cancel until then with your recovery key.
          </small>
          <button disabled={scheduleDeletion.isPending} onClick={() => scheduleDeletion.mutate()} type="button">
            {scheduleDeletion.isPending ? "Scheduling..." : "Confirm schedule deletion"}
          </button>
          <button className="device-cancel" onClick={() => setConfirming(false)} type="button">
            Cancel
          </button>
        </>
      ) : (
        <button className="device-cancel" onClick={() => setConfirming(true)} type="button">
          Schedule deletion
        </button>
      )}
    </div>
  );
}

function EnabledStep({ backup }) {
  const { status, turnOff } = backup;
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="group-member-list">
      <DeletionBanner backup={backup} holdsKey />
      <small>
        Backup is on. {status.data.blobCount} {status.data.blobCount === 1 ? "message" : "messages"} saved (
        {formatBytes(status.data.bytesUsed)}). New messages are backed up from this device automatically.
      </small>
      <small>
        To get a new recovery key, turn backup off and on again. The old backup is deleted.
      </small>
      {turnOff.error && <small className="post-action-error">Couldn&apos;t turn off backup.</small>}
      <div className="group-settings-footer">
        {confirming ? (
          <>
            <small>Delete your backup from our servers? Your messages on this device stay.</small>
            <button disabled={turnOff.isPending} onClick={() => turnOff.mutate()} type="button">
              {turnOff.isPending ? "Deleting..." : "Confirm turn off"}
            </button>
            <button className="device-cancel" onClick={() => setConfirming(false)} type="button">
              Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} type="button">
            Turn off backup
          </button>
        )}
      </div>
    </div>
  );
}

function RestoreStep({ backup, onClose }) {
  const [text, setText] = useState("");
  const { restoreState: state } = backup;
  const isRunning = state.status === "running";

  return (
    <div className="group-member-list">
      <DeletionBanner backup={backup} holdsKey={false} />
      <small>
        A backup exists for your account, but this device doesn&apos;t have it yet. Enter your recovery
        key to read your past messages here.
      </small>
      {state.status !== "done" && (
        <>
          <input
            aria-label="Recovery key"
            autoComplete="off"
            disabled={isRunning}
            onChange={(event) => setText(event.target.value)}
            placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-..."
            spellCheck={false}
            style={MONO}
            value={text}
          />
          <div className="group-settings-footer">
            <button
              disabled={isRunning || !text.trim()}
              onClick={() => backup.restore(text)}
              type="button"
            >
              {isRunning ? "Restoring..." : "Restore history"}
            </button>
            {isRunning && (
              <button className="device-cancel" onClick={backup.cancelRestore} type="button">
                Stop
              </button>
            )}
          </div>
        </>
      )}
      {isRunning && (
        <small>
          Restored {state.progress.restored} messages ({state.progress.skipped} already here)...
        </small>
      )}
      {state.status === "error" && <small className="post-action-error">{state.message}</small>}
      {state.status === "done" && (
        <>
          <small>
            {state.result.cancelled ? "Stopped. " : "Done. "}Restored {state.result.restored}{" "}
            {state.result.restored === 1 ? "message" : "messages"}
            {state.result.failed > 0 ? `, ${state.result.failed} could not be read` : ""}.
          </small>
          <div className="group-settings-footer">
            <button onClick={() => window.location.reload()} type="button">
              Reload to show history
            </button>
          </div>
        </>
      )}
      {state.status !== "done" && (
        <div className="group-settings-footer">
          <button className="device-cancel" disabled={isRunning} onClick={onClose} type="button">
            Continue without history
          </button>
        </div>
      )}
      {state.status !== "done" && <ScheduleDeletion backup={backup} />}
    </div>
  );
}

function OffStep({ backup }) {
  return (
    <div className="group-member-list">
      {backup.disabledElsewhere && (
        <small className="post-action-error">
          Backup was turned off from another device, so this device stopped uploading and forgot its
          key.
        </small>
      )}
      <small>
        Back up your message history so a new device can read your past messages. Each message is
        encrypted on this device with a recovery key that only you hold before it is uploaded.
      </small>
      <small>
        If you lose the recovery key, the backup cannot be opened by anyone, and there is no reset.
      </small>
      <div className="group-settings-footer">
        <button onClick={backup.beginEnable} type="button">
          Turn on backup
        </button>
      </div>
    </div>
  );
}

/** Turn history backup on or off, or restore it on this device. Render with a `key` that changes on open. */
export function ChatBackupModal({ backup, isOpen, onClose, triggerRef }) {
  const handleClose = () => {
    backup.cancelEnable();
    onClose();
  };
  const modalRef = useModalFocusTrap(isOpen, handleClose, triggerRef);

  if (!isOpen) return null;

  const { status, holdsKey, isCheckingKey, pendingKey } = backup;
  let body;
  if (pendingKey) {
    body = (
      <SaveKeyStep
        confirmEnable={backup.confirmEnable}
        onCancel={backup.cancelEnable}
        pendingKey={pendingKey}
      />
    );
  } else if (status.isLoading || isCheckingKey) {
    body = <small>Loading backup status...</small>;
  } else if (status.isError) {
    body = <small className="post-action-error">Couldn&apos;t load backup status.</small>;
  } else if (!status.data.enabled) {
    body = <OffStep backup={backup} />;
  } else if (holdsKey) {
    body = <EnabledStep backup={backup} />;
  } else {
    body = <RestoreStep backup={backup} onClose={handleClose} />;
  }

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        aria-modal="true"
        className="modal group-settings-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="panel-head">
          <h2>Message backup</h2>
          <button aria-label="Close message backup" onClick={handleClose} type="button">
            <FiX />
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
