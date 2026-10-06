"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiBell, FiLock, FiSettings, FiSliders } from "react-icons/fi";
import { QueryNotice } from "../../components/QueryNotice";
import { ReadReceiptsSetting } from "../../components/settings/ReadReceiptsSetting";
import { useToast } from "../../hooks/useToast";
import { api } from "../../lib/api";
import { defaultFeedPreferences, FEED_PREFERENCES_KEY, readStoredJson } from "../../lib/preferences";
import { fallbacks, queries } from "../../lib/queries";

const feedCategories = ["Guide", "Build", "Lore", "Teams", "Strategy"];

export default function SettingsPage() {
  const { notice, showNotice } = useToast();
  const [preferences, setPreferences] = useState(defaultFeedPreferences);
  const home = useQuery(queries.home(""));
  const data = home.data || (api.usingMocks ? fallbacks.home("") : { communities: [] });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPreferences(readStoredJson(FEED_PREFERENCES_KEY, defaultFeedPreferences));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const togglePreference = (group, value) => {
    setPreferences((current) => ({
      ...current,
      [group]: current[group].includes(value)
        ? current[group].filter((item) => item !== value)
        : [...current[group], value],
    }));
  };

  const savePreferences = () => {
    window.localStorage.setItem(FEED_PREFERENCES_KEY, JSON.stringify(preferences));
    showNotice("Feed preferences saved");
  };

  const notAvailable = () => showNotice("This setting is not available yet");

  return (
    <div className="page settings-page">
      <div className="toast-slot" aria-live="polite">{notice}</div>
      <header className="settings-header hero-polish">
        <div className="settings-header-icon"><FiSettings /></div>
        <div>
          <span className="eyebrow">Your account</span>
          <h1>Settings</h1>
          <p>Choose what appears in your feed and manage your account preferences.</p>
        </div>
      </header>

      <div className="settings-layout">
        <nav aria-label="Settings sections" className="panel settings-nav">
          <a href="#feed-preferences"><FiSliders /> Feed preferences</a>
          <a href="#notifications"><FiBell /> Notifications</a>
          <a href="#privacy"><FiLock /> Privacy and safety</a>
        </nav>

        <main className="settings-content">
          <section className="panel settings-section" id="feed-preferences">
            <div className="settings-section-head">
              <div>
                <span className="eyebrow">Feed preferences</span>
                <h2>Fine-tune your home feed</h2>
                <p>Select the communities and topics you want to see more often.</p>
              </div>
              <FiSliders />
            </div>
            <QueryNotice isLoading={home.isLoading} isError={home.isError} />
            <fieldset>
              <legend>Communities</legend>
              <div className="preference-grid">
                {(data.communities || []).map((community) => (
                  <label key={community.slug}>
                    <input checked={preferences.games.includes(community.slug)} onChange={() => togglePreference("games", community.slug)} type="checkbox" />
                    <span>{community.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Topics</legend>
              <div className="preference-grid compact">
                {feedCategories.map((category) => (
                  <label key={category}>
                    <input checked={preferences.categories.includes(category)} onChange={() => togglePreference("categories", category)} type="checkbox" />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="settings-save-row">
              <p className="preference-hint">Leave a section empty to include everything.</p>
              <button className="primary" onClick={savePreferences} type="button">Save preferences</button>
            </div>
          </section>

          <section className="panel settings-section" id="notifications">
            <div className="settings-section-head">
              <div><span className="eyebrow">Notifications</span><h2>Choose how we contact you</h2></div>
              <FiBell />
            </div>
            <button className="settings-placeholder" onClick={notAvailable} type="button"><span><b>Email notifications</b><small>Control updates and community digests.</small></span><span>Coming soon</span></button>
          </section>

          <section className="panel settings-section" id="privacy">
            <div className="settings-section-head">
              <div><span className="eyebrow">Privacy and safety</span><h2>Manage your account controls</h2></div>
              <FiLock />
            </div>
            <ReadReceiptsSetting />
            <button className="settings-placeholder" onClick={notAvailable} type="button"><span><b>Blocked accounts</b><small>Review people you have blocked.</small></span><span>Coming soon</span></button>
          </section>
        </main>
      </div>
    </div>
  );
}
