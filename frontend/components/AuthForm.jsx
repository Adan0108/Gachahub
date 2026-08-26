"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiArrowRight, FiEye, FiEyeOff, FiLock, FiMail, FiUser } from "react-icons/fi";
import { api } from "../lib/api";

export function AuthForm({ mode }) {
  const router = useRouter();
  const isRegister = mode === "register";
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const redirectTimerRef = useRef(null);
  const canSubmit =
    form.email.trim().length > 0 &&
    form.password.length >= 8 &&
    (!isRegister || form.name.trim().length > 0);

  const auth = useMutation({
    mutationFn: () => (isRegister ? api.signUp(form) : api.signIn(form)),
    onSuccess: () => {
      setMessage(isRegister ? "Account created. Redirecting..." : "Logged in. Redirecting...");
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = window.setTimeout(() => router.push("/"), 650);
    },
    onError: (error) => {
      setMessage(error.message || "Auth service is not ready yet.");
    },
  });

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setMessage("");
  };

  const submit = (event) => {
    event.preventDefault();
    if (!canSubmit || auth.isPending) return;
    auth.mutate();
  };

  useEffect(() => () => window.clearTimeout(redirectTimerRef.current), []);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-card-header">
          <Link href="/" className="auth-brand">
            <span>✦</span>
            GachaHub
          </Link>
          <Link href="/" className="auth-back-link">
            <FiArrowLeft />
            Back home
          </Link>
        </div>
        <span className="eyebrow auth-eyebrow">
          {isRegister ? "Create your account" : "Welcome back"}
        </span>
        <h1>{isRegister ? "Join your communities." : "Log in to GachaHub."}</h1>
        <p>
          {isRegister
            ? "Create your profile, follow game communities, and keep your saved builds in one place."
            : "Continue to your communities, saved builds, and daily game updates."}
        </p>

        <form className="auth-form" onSubmit={submit}>
          {isRegister && (
            <label>
              Display name
              <span>
                <FiUser />
                <input
                  required
                  value={form.name}
                  onChange={updateField("name")}
                  placeholder="Hertzy"
                  autoComplete="name"
                />
              </span>
            </label>
          )}
          <label>
            Email
            <span>
              <FiMail />
              <input
                required
                type="email"
                value={form.email}
                onChange={updateField("email")}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </span>
          </label>
          <label>
            Password
            <span className="password-field">
              <FiLock />
              <input
                required
                minLength={8}
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={updateField("password")}
                placeholder="At least 8 characters"
                autoComplete={isRegister ? "new-password" : "current-password"}
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <FiEyeOff /> : <FiEye />}
              </button>
            </span>
          </label>

          {message && (
            <div className={`auth-message ${auth.isError ? "error" : "success"}`}>{message}</div>
          )}

          <button
            className="primary auth-submit"
            disabled={auth.isPending || !canSubmit}
            type="submit"
          >
            {auth.isPending ? "Please wait..." : isRegister ? "Create account" : "Log in"}
            <FiArrowRight />
          </button>
        </form>

        <div className="auth-switch">
          {isRegister ? "Already have an account?" : "New to GachaHub?"}{" "}
          <Link href={isRegister ? "/login" : "/register"}>
            {isRegister ? "Log in" : "Create one"}
          </Link>
        </div>
      </section>
    </main>
  );
}
