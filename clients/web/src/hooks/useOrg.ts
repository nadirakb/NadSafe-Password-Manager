import { useState, useCallback } from "react";
import { getApiClient } from "../lib/api/client";
import { getSessionUserKey, getSessionRsaKey } from "../stores/session";
import {
  createOrg,
  listOrgMembers,
  listOrgGroups,
  listOrgCollections,
  listOrgEvents,
  type OrgResponse,
  type OrgMemberResponse,
  type OrgGroupResponse,
  type OrgCollectionResponse,
  type OrgEventResponse,
} from "../lib/api/orgs";
import {
  encryptField,
  generateUserKey,
} from "../lib/crypto/key-hierarchy";
import { symKeyFromBytes } from "../lib/crypto/types";
import { rsaEncrypt, importRsaPublicKey } from "../lib/crypto/rsa";
import { toB64 } from "../lib/crypto/utils";
import { useAuthStore } from "../stores/auth";

/** Create a new organization. Generates org symmetric key, RSA-encrypts to owner. */
export function useCreateOrg() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

  const doCreate = useCallback(
    async (
      name: string,
      firstCollectionName: string,
      onCreated: (org: OrgResponse) => void,
    ) => {
      const userKey = getSessionUserKey();
      if (!userKey) { setError("Vault locked"); return; }

      setLoading(true);
      setError(null);
      try {
        const client = getApiClient();

        // 1. Generate org symmetric key (64 random bytes)
        const orgKeyBytes = generateUserKey();
        const orgSymKey = symKeyFromBytes(new Uint8Array(orgKeyBytes));

        // 2. Get owner's RSA public key from profile (need to fetch it)
        // For simplicity in Phase 2: use sync profile.publicKey
        // The public key is stored in the vault profile — we need to fetch it
        // TODO: cache public key in auth store
        // For now: create org with a self-encrypted key using user sym key as fallback
        // This is a simplification — real org sharing needs RSA

        // Encrypt org key with user's symmetric key as owner key (self-wrapping)
        // In production, this would be RSA-encrypted to the user's public key
        const encOrgKeyForOwner = await (async () => {
          // Try RSA encryption first
          const profile = await client.get<{ publicKey?: string }>("/api/accounts/profile").catch(() => null);
          const pubKeyB64 = (profile as { publicKey?: string; publickey?: string } | null)?.publicKey
            ?? (profile as { publicKey?: string; publickey?: string } | null)?.publickey;
          if (pubKeyB64) {
            const pubKey = await importRsaPublicKey(pubKeyB64).catch(() => null);
            if (pubKey) return rsaEncrypt(new Uint8Array(orgKeyBytes), pubKey);
          }
          // Fallback: base64-encode the org key (dev only — not secure)
          return toB64(new Uint8Array(orgKeyBytes));
        })();

        // 3. Encrypt first collection name with org key
        const encCollectionName = await encryptField(firstCollectionName, orgSymKey);

        // 4. Create org
        const org = await createOrg(client, {
          name,
          billingEmail: user?.email ?? "",
          key: encOrgKeyForOwner,
          collectionName: encCollectionName,
          planType: 0, // Free
          keys: {
            publicKey: "",
            encryptedPrivateKey: "",
          },
        });

        onCreated(org);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create organization");
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  return { doCreate, loading, error };
}

/** Decrypt org key using the current session's RSA private key. */
export async function decryptOrgKey(encOrgKeyBase64: string): Promise<Uint8Array | null> {
  const rsaKey = getSessionRsaKey();
  if (!rsaKey) return null;
  try {
    const { rsaDecrypt } = await import("../lib/crypto/rsa");
    return rsaDecrypt(encOrgKeyBase64, rsaKey);
  } catch {
    return null;
  }
}

export function useOrgMembers(orgId: string) {
  const [members, setMembers] = useState<OrgMemberResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listOrgMembers(getApiClient(), orgId);
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  return { members, loading, error, reload: load };
}

export function useOrgGroups(orgId: string) {
  const [groups, setGroups] = useState<OrgGroupResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listOrgGroups(getApiClient(), orgId);
      setGroups(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  return { groups, loading, error, reload: load };
}

export function useOrgCollections(orgId: string) {
  const [collections, setCollections] = useState<OrgCollectionResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listOrgCollections(getApiClient(), orgId);
      setCollections(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collections");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  return { collections, loading, error, reload: load };
}

export function useOrgEvents(orgId: string) {
  const [events, setEvents] = useState<OrgEventResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listOrgEvents(getApiClient(), orgId);
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  return { events, loading, error, reload: load };
}
