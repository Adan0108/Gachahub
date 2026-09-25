"use client";

import { useState } from "react";
import { FiMonitor, FiX } from "react-icons/fi";
import { useChatDevices } from "../hooks/useChatDevices";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { removableDevices, sortDevices } from "../lib/mls/device/deviceList";
import { relativeTime } from "../lib/chatDisplay";

const ALL = "all";

function DeviceRow({ device, isCurrent, isConfirming, isBusy, onAsk, onCancel, onConfirm }) {
  const isRemoved = Boolean(device.revokedAt);
  return (
    <div className={`group-member-row ${isRemoved ? "device-removed" : ""}`}>
      <FiMonitor aria-hidden="true" />
      <span className="group-member-name">
        <b>
          Device {device.id.slice(0, 8)}
          {isCurrent ? " (This device)" : ""}
        </b>
        <small>
          Added {relativeTime(device.createdAt)} ·{" "}
          {device.lastSeenAt ? `last seen ${relativeTime(device.lastSeenAt)}` : "never seen"}
          {isRemoved && " · Removed"}
        </small>
      </span>
      {!isCurrent && !isRemoved && (
        <span className="group-member-actions">
          {isConfirming ? (
            <>
              <button className="danger" disabled={isBusy} onClick={onConfirm} type="button">
                {isBusy ? "Removing..." : "Confirm remove"}
              </button>
              <button disabled={isBusy} onClick={onCancel} type="button">
                Cancel
              </button>
            </>
          ) : (
            <button className="danger" disabled={isBusy} onClick={onAsk} type="button">
              Remove
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * The user's own chat devices with per-device and remove-all-others actions, each behind a confirm
 * step. Removing this device is not offered here (that is sign-out). Render with a `key` that
 * changes on open so the confirm step resets, like GroupSettingsModal.
 */
export function DevicesModal({ currentDeviceId, isOpen, onClose, syncEngine, triggerRef }) {
  const modalRef = useModalFocusTrap(isOpen, onClose, triggerRef);
  const { devices, remove } = useChatDevices(isOpen, syncEngine);
  // A device id, or ALL, awaiting its confirm click.
  const [confirming, setConfirming] = useState(null);

  if (!isOpen) return null;

  const items = sortDevices(devices.data || [], currentDeviceId);
  const others = removableDevices(items, currentDeviceId);
  const run = (deviceIds) =>
    remove.mutate(deviceIds, { onSettled: () => setConfirming(null) });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="devices-modal-title"
        aria-modal="true"
        className="modal group-settings-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="panel-head">
          <h2 id="devices-modal-title">Your devices</h2>
          <button aria-label="Close your devices" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        <div className="group-member-list">
          {devices.isLoading && <small>Loading devices...</small>}
          {devices.isError && <small className="post-action-error">Couldn&apos;t load devices.</small>}
          {items.map((device) => (
            <DeviceRow
              device={device}
              isBusy={remove.isPending}
              isConfirming={confirming === device.id}
              isCurrent={device.id === currentDeviceId}
              key={device.id}
              onAsk={() => setConfirming(device.id)}
              onCancel={() => setConfirming(null)}
              onConfirm={() => run([device.id])}
            />
          ))}
          {devices.isSuccess && items.length === 0 && <small>No devices found.</small>}
        </div>
        {remove.error && <small className="post-action-error">{remove.error.message}</small>}

        {others.length > 0 && (
          <div className="group-settings-footer">
            {confirming === ALL ? (
              <>
                <small>
                  Remove {others.length} other {others.length === 1 ? "device" : "devices"}? They
                  will stop receiving messages.
                </small>
                <button
                  disabled={remove.isPending}
                  onClick={() => run(others.map((device) => device.id))}
                  type="button"
                >
                  {remove.isPending ? "Removing..." : "Confirm remove all"}
                </button>
                <button
                  className="device-cancel"
                  disabled={remove.isPending}
                  onClick={() => setConfirming(null)}
                  type="button"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                disabled={remove.isPending}
                onClick={() => setConfirming(ALL)}
                type="button"
              >
                Remove all other devices
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
