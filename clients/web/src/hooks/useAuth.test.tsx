// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLogin, useRegister, useLogout } from "./useAuth";
import { useAuthStore } from "../stores/auth";
import { getSessionUserKey, clearSessionKey } from "../stores/session";
import { prelogin, loginWithPassword, register, TwoFactorRequiredError } from "../lib/api/auth";
import { deriveLoginKeys, generateUserKey, wrapUserKey } from "../lib/crypto/key-hierarchy";
import type { KdfParams } from "../lib/crypto/types";
import type { TokenResponse, RegisterRequest } from "../lib/api/types";

const navigateMock = vi.hoisted(() => vi.fn());
const setTokenMock = vi.hoisted(() => vi.fn());
const mockClient = vi.hoisted(() => ({ setToken: (t: string) => setTokenMock(t) }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../lib/api/client", () => ({
  initApiClient: vi.fn(() => mockClient),
}));

vi.mock("../lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/auth")>();
  return {
    ...actual,
    prelogin: vi.fn(),
    loginWithPassword: vi.fn(),
    register: vi.fn(),
    getOrCreateDeviceId: vi.fn(() => "test-device-id"),
  };
});

vi.mock("../lib/api/orgs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/orgs")>();
  return {
    ...actual,
    fetchUserPolicies: vi.fn().mockResolvedValue([]),
  };
});

const preloginMock = vi.mocked(prelogin);
const loginWithPasswordMock = vi.mocked(loginWithPassword);
const registerMock = vi.mocked(register);

// React 18+ requires this flag for act() outside a test renderer
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal renderHook (no @testing-library dependency). */
function renderHook<T>(useHook: () => T): { result: { current: T } } {
  const result = { current: undefined as T };
  function TestComponent() {
    result.current = useHook();
    return null;
  }
  let root: Root | undefined;
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(<TestComponent />);
  });
  void root;
  return { result };
}

const SERVER = "https://vault.example.com";
const EMAIL = "user@example.com";
const PASSWORD = "masterpassword";
const PBKDF2_PARAMS: KdfParams = { type: "pbkdf2", iterations: 5000 };

/** Build a server-side fixture: a user key wrapped with the stretched master key. */
async function makeWrappedUserKey(kdfParams: KdfParams): Promise<string> {
  const { encKey, macKey } = await deriveLoginKeys(PASSWORD, EMAIL, kdfParams);
  return wrapUserKey(generateUserKey(), { encKey, macKey });
}

function tokenResponse(encUserKey: string): TokenResponse {
  return {
    access_token: "test-access-token",
    expires_in: 3600,
    token_type: "Bearer",
    refresh_token: "test-refresh-token",
    scope: "api offline_access",
    Key: encUserKey,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionKey();
  useAuthStore.getState().logout();
  localStorage.clear();
});

describe("useLogin", () => {
  it("completes the full login flow", async () => {
    const encUserKey = await makeWrappedUserKey(PBKDF2_PARAMS);
    preloginMock.mockResolvedValue({ kdf: 0, kdfIterations: 5000 });
    loginWithPasswordMock.mockResolvedValue(tokenResponse(encUserKey));

    const { result } = renderHook(useLogin);
    await act(async () => {
      await result.current.doLogin(SERVER, EMAIL, PASSWORD);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(setTokenMock).toHaveBeenCalledWith("test-access-token");
    expect(getSessionUserKey()).not.toBeNull();
    const auth = useAuthStore.getState();
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.user?.email).toBe(EMAIL);
    expect(auth.user?.kdfType).toBe("pbkdf2");
    expect(auth.encryptedUserKey).toBe(encUserKey);
    expect(navigateMock).toHaveBeenCalledWith("/vault");
  });

  it("converts server Argon2id kdfMemory from MB to KiB", async () => {
    const argonParams: KdfParams = { type: "argon2id", mCost: 1024, tCost: 1, pCost: 1 };
    const encUserKey = await makeWrappedUserKey(argonParams);
    // kdfMemory is in MB per Vaultwarden 1.32+; 1 MB → 1024 KiB
    preloginMock.mockResolvedValue({ kdf: 1, kdfIterations: 1, kdfMemory: 1, kdfParallelism: 1 });
    loginWithPasswordMock.mockResolvedValue(tokenResponse(encUserKey));

    const { result } = renderHook(useLogin);
    await act(async () => {
      await result.current.doLogin(SERVER, EMAIL, PASSWORD);
    });

    expect(result.current.error).toBeNull();
    const user = useAuthStore.getState().user;
    expect(user?.kdfType).toBe("argon2id");
    expect(user?.kdfParams).toEqual({ mCost: 1024, tCost: 1, pCost: 1 });
  });

  it("surfaces login failure via error state", async () => {
    preloginMock.mockResolvedValue({ kdf: 0, kdfIterations: 5000 });
    loginWithPasswordMock.mockRejectedValue(new Error("Username or password is incorrect"));

    const { result } = renderHook(useLogin);
    await act(async () => {
      await result.current.doLogin(SERVER, EMAIL, PASSWORD);
    });

    expect(result.current.error).toBe("Username or password is incorrect");
    expect(result.current.loading).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(getSessionUserKey()).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("errors when server omits the vault key", async () => {
    preloginMock.mockResolvedValue({ kdf: 0, kdfIterations: 5000 });
    loginWithPasswordMock.mockResolvedValue({ ...tokenResponse("x"), Key: undefined, key: undefined });

    const { result } = renderHook(useLogin);
    await act(async () => {
      await result.current.doLogin(SERVER, EMAIL, PASSWORD);
    });

    expect(result.current.error).toMatch(/did not return vault key/);
  });

  it("2FA: caches key material and skips re-running the KDF on the retry", async () => {
    const encUserKey = await makeWrappedUserKey(PBKDF2_PARAMS);
    preloginMock.mockResolvedValue({ kdf: 0, kdfIterations: 5000 });
    loginWithPasswordMock
      .mockRejectedValueOnce(new TwoFactorRequiredError([0]))
      .mockResolvedValueOnce(tokenResponse(encUserKey));

    const { result } = renderHook(useLogin);

    // First attempt → server demands 2FA
    await act(async () => {
      await result.current.doLogin(SERVER, EMAIL, PASSWORD);
    });
    expect(result.current.needsTwoFactor).toBe(true);
    expect(result.current.error).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(preloginMock).toHaveBeenCalledTimes(1);

    // Retry with TOTP code → must reuse cached key material (no second prelogin/KDF)
    await act(async () => {
      await result.current.doLogin(SERVER, EMAIL, PASSWORD, "123456");
    });
    expect(preloginMock).toHaveBeenCalledTimes(1); // not called again
    expect(result.current.needsTwoFactor).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(getSessionUserKey()).not.toBeNull();
    // 2FA token forwarded to the API
    expect(loginWithPasswordMock).toHaveBeenLastCalledWith(
      mockClient, EMAIL, expect.any(Uint8Array), "test-device-id", "123456",
    );
  });
});

describe("useRegister", () => {
  it("registers, logs in, and produces a recovery phrase", async () => {
    // The hook wraps a fresh user key and sends it in the register request;
    // echo it back from the login mock the way the real server would.
    let registeredKey = "";
    registerMock.mockImplementation(async (_c, req: RegisterRequest) => {
      registeredKey = req.key;
    });
    loginWithPasswordMock.mockImplementation(async () => tokenResponse(registeredKey));

    const { result } = renderHook(useRegister);
    await act(async () => {
      await result.current.doRegister(SERVER, EMAIL, "Test User", PASSWORD);
    });

    expect(result.current.error).toBeNull();
    const req = registerMock.mock.calls[0][1];
    expect(req.email).toBe(EMAIL);
    expect(req.kdf).toBe(1); // argon2id
    expect(req.kdfMemory).toBe(64); // 65536 KiB → 64 MB on the wire
    expect(req.kdfIterations).toBe(3);
    expect(req.key.startsWith("2.")).toBe(true);
    expect(req.keys.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(req.keys.encryptedPrivateKey.startsWith("2.")).toBe(true);

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(getSessionUserKey()).not.toBeNull();

    // Recovery phrase entropy is exposed and the wrapped key persisted locally
    expect(result.current.recoveryEntropy?.length).toBe(32);
    expect(localStorage.getItem(`ns_rk:${SERVER}|${EMAIL}`)).toMatch(/^2\./);

    // Navigation deferred until the recovery modal is dismissed
    expect(navigateMock).not.toHaveBeenCalled();
    act(() => result.current.dismissRecovery());
    expect(navigateMock).toHaveBeenCalledWith("/vault");
    expect(result.current.recoveryEntropy).toBeNull();
  }, 60_000);

  it("surfaces registration failure via error state", async () => {
    registerMock.mockRejectedValue(new Error("Email already in use"));

    const { result } = renderHook(useRegister);
    await act(async () => {
      await result.current.doRegister(SERVER, EMAIL, "Test User", PASSWORD);
    });

    expect(result.current.error).toBe("Email already in use");
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  }, 60_000);
});

describe("useLogout", () => {
  it("clears session key, auth state, and navigates to /login", async () => {
    // Simulate a logged-in state
    useAuthStore.getState().login(
      { id: "u1", email: EMAIL, name: "Test", kdfType: "pbkdf2", kdfParams: { iterations: 5000 } },
      "token", "refresh", "2.enc-key",
    );

    const { result } = renderHook(useLogout);
    act(() => result.current());

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(getSessionUserKey()).toBeNull();
    expect(navigateMock).toHaveBeenCalledWith("/login");
  });
});
