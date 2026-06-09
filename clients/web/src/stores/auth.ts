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
  /** Base64-encoded DER public key — cached after login for org operations. */
  publicKey?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isLocked: boolean;
  user: AuthUser | null;
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  /** Encrypted user key (EncString). Persisted to survive page reload. */
  encryptedUserKey: string | null;
  /** Encrypted RSA private key (EncString). Needed for org key operations. */
  encryptedPrivateKey: string | null;

  /** True when user's org requires 2FA but they logged in without it. */
  requires2FASetup: boolean;
  setRequires2FASetup: (v: boolean) => void;

  setServerUrl: (url: string) => void;
  /** Cache the account's RSA public key (base64 DER) for org key operations. */
  setPublicKey: (publicKey: string) => void;
  login: (
    user: AuthUser,
    accessToken: string,
    refreshToken: string,
    encryptedUserKey: string,
    encryptedPrivateKey?: string | null,
  ) => void;
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
      encryptedPrivateKey: null,
      requires2FASetup: false,

      setRequires2FASetup: (v) => set({ requires2FASetup: v }),

      setServerUrl: (url) => set({ serverUrl: url.replace(/\/$/, "") }),

      setPublicKey: (publicKey) =>
        set((s) => (s.user ? { user: { ...s.user, publicKey } } : {})),

      login: (user, accessToken, refreshToken, encryptedUserKey, encryptedPrivateKey) =>
        set({
          isAuthenticated: true,
          isLocked: false,
          user,
          accessToken,
          refreshToken,
          encryptedUserKey,
          encryptedPrivateKey: encryptedPrivateKey ?? null,
        }),

      lock: () => set({ isLocked: true, accessToken: null }),

      unlock: (accessToken) => set({ isLocked: false, accessToken }),

      logout: () =>
        set({
          isAuthenticated: false,
          isLocked: false,
          user: null,
          accessToken: null,
          refreshToken: null,
          encryptedUserKey: null,
          encryptedPrivateKey: null,
          requires2FASetup: false,
        }),
    }),
    {
      name: "nadsafe-auth",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        isAuthenticated: s.isAuthenticated,
        user: s.user,
        serverUrl: s.serverUrl,
        refreshToken: s.refreshToken,
        encryptedUserKey: s.encryptedUserKey,
        encryptedPrivateKey: s.encryptedPrivateKey,
      }),
    },
  ),
);
