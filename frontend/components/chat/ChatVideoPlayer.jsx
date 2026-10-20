"use client";

import { useRef, useState } from "react";
import { FiMaximize, FiPause, FiPlay, FiVolume2, FiVolumeX } from "react-icons/fi";
import { clampTime, formatClock } from "../../lib/chat/videoTime";
import "./ChatVideoPlayer.css";

const SEEK_STEP_SECONDS = 5;

/**
 * The player for a video in a chat: a big play button before it starts, then a control bar that
 * matches the app (play, seek, time, volume, fullscreen). Space or K plays and pauses, the arrow
 * keys seek, M mutes and F goes fullscreen while it has focus. With `onExpand`, that button opens
 * the chat's media viewer instead of the browser's fullscreen; `hideExpand` leaves it out (inside the viewer).
 */
export function ChatVideoPlayer({ src, poster, label = "Video", autoPlay = false, onExpand, hideExpand = false }) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      // A browser may refuse to start by itself; the paused state then just stays on screen
      video.play()?.catch(() => {});
    } else {
      video.pause();
    }
  };
  const seekTo = (seconds) => {
    const video = videoRef.current;
    if (!video) return;
    const next = clampTime(seconds, video.duration);
    video.currentTime = next;
    setTime(next);
  };
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };
  const setLevel = (level) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = level;
    video.muted = level === 0;
    setVolume(level);
    setIsMuted(video.muted);
  };
  const goFullscreen = () => {
    if (hideExpand) return;
    if (onExpand) {
      videoRef.current?.pause();
      onExpand();
    } else if (document.fullscreenElement) document.exitFullscreen?.();
    else frameRef.current?.requestFullscreen?.();
  };

  const onKeyDown = (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const video = videoRef.current;
    const handled = {
      " ": toggle,
      k: toggle,
      m: toggleMute,
      f: goFullscreen,
      ArrowLeft: () => seekTo((video?.currentTime ?? 0) - SEEK_STEP_SECONDS),
      ArrowRight: () => seekTo((video?.currentTime ?? 0) + SEEK_STEP_SECONDS),
    }[event.key];
    if (!handled) return;
    event.preventDefault();
    handled();
  };

  return (
    <div className="chat-video" onKeyDown={onKeyDown} ref={frameRef} role="group" aria-label={label} tabIndex={0}>
      <video
        autoPlay={autoPlay}
        className="chat-video-screen"
        onClick={toggle}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => {
          setIsPlaying(true);
          setHasStarted(true);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        playsInline
        poster={poster}
        ref={videoRef}
        src={src}
      />

      {!isPlaying && (
        <button
          // Once it has started, the bar's own Play button is the one for keyboards and screen readers
          aria-hidden={hasStarted ? "true" : undefined}
          aria-label={`Play ${label}`}
          className="chat-video-big-play"
          onClick={toggle}
          tabIndex={hasStarted ? -1 : 0}
          type="button"
        >
          <FiPlay aria-hidden="true" />
        </button>
      )}

      <div className="chat-video-bar">
        <button aria-label={isPlaying ? "Pause" : "Play"} onClick={toggle} type="button">
          {isPlaying ? <FiPause aria-hidden="true" /> : <FiPlay aria-hidden="true" />}
        </button>
        <input
          aria-label="Seek"
          aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
          className="chat-video-seek"
          max={duration || 0}
          min={0}
          onChange={(event) => seekTo(Number(event.target.value))}
          step="any"
          type="range"
          value={clampTime(time, duration)}
        />
        <span className="chat-video-time">
          {formatClock(time)} / {formatClock(duration)}
        </span>
        <button aria-label={isMuted ? "Unmute" : "Mute"} onClick={toggleMute} type="button">
          {isMuted || volume === 0 ? <FiVolumeX aria-hidden="true" /> : <FiVolume2 aria-hidden="true" />}
        </button>
        <input
          aria-label="Volume"
          className="chat-video-volume"
          max={1}
          min={0}
          onChange={(event) => setLevel(Number(event.target.value))}
          step={0.05}
          type="range"
          value={isMuted ? 0 : volume}
        />
        {!hideExpand && (
          <button aria-label={onExpand ? "Open larger" : "Fullscreen"} onClick={goFullscreen} type="button">
            <FiMaximize aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
