import type { ApiClient } from "./client";

// ── Response types ──────────────────────────────────────────────────────────

export interface OrgResponse {
  id: string;
  name: string;
  key: string;          // org symmetric key RSA-encrypted to this member
  type: number;         // 0=Owner,1=Admin,2=User,3=Manager
  enabled: boolean;
  usersCount?: number;
  collectionsCount?: number;
  object: string;
}

export interface OrgMemberResponse {
  id: string;           // org-user UUID
  userId: string | null;
  name: string | null;
  email: string;
  type: number;         // 0=Owner,1=Admin,2=User,3=Manager,4=Custom
  status: number;       // -1=Revoked,0=Invited,1=Accepted,2=Confirmed
  collections: OrgMemberCollectionAccess[];
  groups: string[];
  object: string;
}

export interface OrgMemberCollectionAccess {
  id: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
}

export interface OrgGroupResponse {
  id: string;
  organizationId: string;
  name: string;
  accessAll: boolean;
  collections: GroupCollectionAccess[];
  users: string[];
  object: string;
}

export interface GroupCollectionAccess {
  id: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
}

export interface OrgCollectionResponse {
  id: string;
  organizationId: string;
  name: string;         // EncString
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  groups: GroupCollectionAccess[];
  users: OrgMemberCollectionAccess[];
  object: string;
}

export interface OrgEventResponse {
  type: number;
  actingUserId: string | null;
  date: string;
  deviceType: number | null;
  ipAddress: string | null;
  memberId: string | null;
  itemId: string | null;
  collectionId: string | null;
  groupId: string | null;
  policyId: string | null;
  installationId: string | null;
  object: string;
}

// ── Request types ───────────────────────────────────────────────────────────

export interface CreateOrgRequest {
  name: string;
  billingEmail: string;
  key: string;              // org key RSA-encrypted to owner
  collectionName: string;   // EncString encrypted with org key
  planType: number;         // 0=Free
  keys: {
    publicKey: string;
    encryptedPrivateKey: string;
  };
}

export interface InviteMemberRequest {
  emails: string[];
  type: number;
  collections: { id: string; readOnly: boolean; hidePasswords: boolean; manage: boolean }[];
  groups: string[];
}

export interface CreateGroupRequest {
  name: string;
  accessAll: boolean;
  collections: GroupCollectionAccess[];
}

export interface CreateCollectionRequest {
  name: string;  // EncString
  groups: GroupCollectionAccess[];
  users: OrgMemberCollectionAccess[];
}

// ── API functions ────────────────────────────────────────────────────────────

export async function listOrgs(client: ApiClient): Promise<OrgResponse[]> {
  const res = await client.get<{ data: OrgResponse[] }>("/api/organizations");
  return res.data ?? [];
}

export async function createOrg(client: ApiClient, req: CreateOrgRequest): Promise<OrgResponse> {
  return client.post<OrgResponse>("/api/organizations", req);
}

export async function getOrg(client: ApiClient, orgId: string): Promise<OrgResponse> {
  return client.get<OrgResponse>(`/api/organizations/${orgId}`);
}

export async function listOrgMembers(client: ApiClient, orgId: string): Promise<OrgMemberResponse[]> {
  const res = await client.get<{ data: OrgMemberResponse[] }>(`/api/organizations/${orgId}/users`);
  return res.data ?? [];
}

export async function inviteMembers(
  client: ApiClient,
  orgId: string,
  req: InviteMemberRequest,
): Promise<void> {
  return client.post<void>(`/api/organizations/${orgId}/users/invite`, req);
}

export async function removeOrgMember(
  client: ApiClient,
  orgId: string,
  memberId: string,
): Promise<void> {
  return client.delete<void>(`/api/organizations/${orgId}/users/${memberId}`);
}

export async function listOrgGroups(client: ApiClient, orgId: string): Promise<OrgGroupResponse[]> {
  const res = await client.get<{ data: OrgGroupResponse[] }>(`/api/organizations/${orgId}/groups`);
  return res.data ?? [];
}

export async function createGroup(
  client: ApiClient,
  orgId: string,
  req: CreateGroupRequest,
): Promise<OrgGroupResponse> {
  return client.post<OrgGroupResponse>(`/api/organizations/${orgId}/groups`, req);
}

export async function deleteGroup(client: ApiClient, orgId: string, groupId: string): Promise<void> {
  return client.delete<void>(`/api/organizations/${orgId}/groups/${groupId}`);
}

export async function listOrgCollections(
  client: ApiClient,
  orgId: string,
): Promise<OrgCollectionResponse[]> {
  const res = await client.get<{ data: OrgCollectionResponse[] }>(
    `/api/organizations/${orgId}/collections`,
  );
  return res.data ?? [];
}

export async function createCollection(
  client: ApiClient,
  orgId: string,
  req: CreateCollectionRequest,
): Promise<OrgCollectionResponse> {
  return client.post<OrgCollectionResponse>(`/api/organizations/${orgId}/collections`, req);
}

export async function deleteCollection(
  client: ApiClient,
  orgId: string,
  collectionId: string,
): Promise<void> {
  return client.delete<void>(`/api/organizations/${orgId}/collections/${collectionId}`);
}

export async function listOrgEvents(
  client: ApiClient,
  orgId: string,
  start?: string,
  end?: string,
): Promise<OrgEventResponse[]> {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString() ? `?${params}` : "";
  const res = await client.get<{ data: OrgEventResponse[] }>(
    `/api/organizations/${orgId}/events${qs}`,
  );
  return res.data ?? [];
}
