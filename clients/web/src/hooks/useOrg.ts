import { useState, useCallback } from "react";
import { getApiClient } from "../lib/api/client";
import { getSessionUserKey, getSessionRsaKey } from "../stores/session";
import {
  createOrg,
  listOrgMembers,
  getOrgMember,
  confirmOrgMember,
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
import { rsaEncrypt, rsaDecrypt, importRsaPublicKey } from "../lib/crypto/rsa";
import { useAuthStore } from "../stores/auth";

/**
 * Resolve the current account's RSA public key as a CryptoKey.
 * Prefers the value cached in the auth store; otherwise fetches it from the
 * profile endpoint and caches it. Throws if the account has no public key —
 * callers must not fall back to storing keys unencrypted.
 */
async function resolveOwnPublicKey(client: ReturnType<typeof getApiClient>): Promise<CryptoKey> {
  let pubKeyB64 = useAuthStore.getState().user?.publicKey ?? null;
  if (!pubKeyB64) {
    const profile = await client
      .get<{ publicKey?: string; publickey?: string }>("/api/accounts/profile")
      .catch(() => null);
    pubKeyB64 = profile?.publicKey ?? profile?.publickey ?? null;
    if (pubKeyB64) useAuthStore.getState().setPublicKey(pubKeyB64);
  }
  if (!pubKeyB64) {
    throw new Error("Cannot create organization: your account public key is unavailable");
  }
  return importRsaPublicKey(pubKeyB64);
}

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

        // 2. RSA-encrypt the org key to the owner's public key.
        // Resolve the public key from the auth store, falling back to the
        // profile endpoint (and caching it). No plaintext fallback: storing the
        // org key unencrypted would hand the server the org's vault key and
        // break zero-knowledge, so org creation fails closed if it is missing.
        const ownerPubKey = await resolveOwnPublicKey(client);
        const encOrgKeyForOwner = await rsaEncrypt(new Uint8Array(orgKeyBytes), ownerPubKey);

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

/**
 * Confirm an accepted org member — decrypt org key with our RSA private key,
 * re-encrypt to the member's RSA public key, and POST confirm.
 *
 * @param org - org object with org.key (our encrypted copy of the org sym key)
 * @param memberId - org-user UUID to confirm
 * @returns error string on failure, null on success
 */
export async function confirmMemberWithOrgKey(
  orgId: string,
  org: OrgResponse,
  memberId: string,
): Promise<string | null> {
  try {
    const client = getApiClient();

    // 1. Decrypt org symmetric key with our RSA private key
    const orgKeyBytes = await decryptOrgKey(org.key);
    if (!orgKeyBytes) return "Vault locked or RSA key unavailable";

    // 2. Fetch the accepted member's public key
    const memberDetail = await getOrgMember(client, orgId, memberId);
    if (!memberDetail.publicKey) return "Member has no public key — they must accept the invitation first";

    // 3. RSA-encrypt org key to member's public key
    const memberPubKey = await importRsaPublicKey(memberDetail.publicKey);
    const encOrgKeyForMember = await rsaEncrypt(orgKeyBytes, memberPubKey);

    // 4. Confirm the member
    await confirmOrgMember(client, orgId, memberId, encOrgKeyForMember);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Confirm failed";
  }
}

/** Decrypt org key using the current session's RSA private key. */
export async function decryptOrgKey(encOrgKeyBase64: string): Promise<Uint8Array | null> {
  const rsaKey = getSessionRsaKey();
  if (!rsaKey) return null;
  try {
    return await rsaDecrypt(encOrgKeyBase64, rsaKey);
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
