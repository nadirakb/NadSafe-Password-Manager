import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  kdfType: "argon2id" | "pbkdf2";
  kdfParams: {
    mCost?: number;
    tCost?: number;
    pCost?: number;
    iterations?: number;
  };
}

interface AuthState {
  isAuthenticated: boolean;
  isLocked: boolean;
  user: AuthUser | null;
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  // The server-side encrypted user key (EncString).
  // Persisted so unlock can unwrap the vault key without a fresh login.
  encryptedUserKey: string | null;

  // Actions
  setServerUrl: (url: string) => void;
  login: (user: AuthUser, accessToken: string, refreshToken: string, encryptedUserKey: string) => void;
  lock: () => void;
  unlock: (accessToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      isLocked: false,
      user: null,
      serverUrl: "",
      accessToken: null,
      refreshToken: null,
      encryptedUserKey: null,

      setServerUrl: (url) => set({ serverUrl: url.replace(/\/$/, "") }),

      login: (user, accessToken, refreshToken, encryptedUserKey) =>
        set({ isAuthenticated: true, isLocked: false, user, accessToken, refreshToken, encryptedUserKey }),

      lock: () => set({ isLocked: true, accessToken: null }),

      unlock: (accessToken) => set({ isLocked: false, accessToken }),

      logout: () =>
        set({
          isAuthenticated: false,
          isLocked: false,
          user: null,
          accessToken: null,
          refreshToken: null,
        }),
    }),
    {
      name: "nadsafe-auth",
      storage: createJSONStorage(() => sessionStorage),
      // Don't persist access tokens across page reloads — re-auth required
      partialize: (s) => ({
        isAuthenticated: s.isAuthenticated,
        user: s.user,
        serverUrl: s.serverUrl,
        refreshToken: s.refreshToken,
        encryptedUserKey: s.encryptedUserKey,
      }),
    },
  ),
);
