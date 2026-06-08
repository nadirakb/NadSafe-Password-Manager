/**
 * Base HTTP client for the Bitwarden-compatible NadSafe/Vaultwarden API.
 */

import type { ApiError } from "./types";

export class ApiResponseError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.message ?? `API error ${status}`);
    this.name = "ApiResponseError";
  }
}

export class ApiClient {
  private accessToken: string | null = null;

  constructor(private baseUrl: string) {}

  setToken(token: string | null) {
    this.accessToken = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { form?: boolean; noAuth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Bitwarden-Client-Name": "web",
      "Bitwarden-Client-Version": "2024.1.0",
    };

    if (!options.noAuth && this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    let requestBody: string | URLSearchParams | undefined;
    if (body !== undefined) {
      if (options.form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        requestBody = new URLSearchParams(body as Record<string, string>);
      } else {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify(body);
      }
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: requestBody,
    });

    if (!res.ok) {
      let errorBody: ApiError = { message: res.statusText };
      try {
        errorBody = await res.json();
      } catch {
        // ignore parse error
      }
      throw new ApiResponseError(res.status, errorBody);
    }

    // 204 No Content
    if (res.status === 204) return undefined as T;

    return res.json() as Promise<T>;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown, opts?: { form?: boolean; noAuth?: boolean }): Promise<T> {
    return this.request<T>("POST", path, body, opts);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}

/** Singleton factory — replaced during login with the user's server URL. */
let _client: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!_client) throw new Error("API client not initialized — call initApiClient first");
  return _client;
}

export function initApiClient(serverUrl: string): ApiClient {
  // When server URL matches the current page origin, use empty base so
  // the Vite dev proxy (or same-origin deployment) intercepts /api and /identity.
  const base =
    serverUrl === window.location.origin || serverUrl === ""
      ? ""
      : serverUrl;
  _client = new ApiClient(base);
  return _client;
}
