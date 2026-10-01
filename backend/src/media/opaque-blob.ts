export type OpaqueBlobKind = 'BLOB' | 'THUMB';

export const MAX_OPAQUE_BLOBS_PER_MESSAGE = 10;

// unattached (INITIATED/UPLOADED) opaque rows one user may hold at once
export const MAX_PENDING_OPAQUE_UPLOADS = 40;

const OPAQUE_FOLDERS: Record<OpaqueBlobKind, string> = {
  BLOB: 'gachahub/chat-blob',
  THUMB: 'gachahub/chat-thumb',
};

// includes the AES-GCM tag; cloudinary raw limits vary by plan
export const OPAQUE_MAX_BYTES: Record<OpaqueBlobKind, number> = {
  BLOB: 25 * 1024 * 1024,
  THUMB: 512 * 1024,
};

export function opaqueFolder(kind: OpaqueBlobKind, userId: string): string {
  return `${OPAQUE_FOLDERS[kind]}/${userId}`;
}

// legacy rows predate the opaqueKind column; the server-generated folder marks them
function opaqueKindFromPublicId(publicId: string): OpaqueBlobKind | null {
  for (const kind of Object.keys(OPAQUE_FOLDERS) as OpaqueBlobKind[]) {
    if (publicId.startsWith(`${OPAQUE_FOLDERS[kind]}/`)) {
      return kind;
    }
  }

  return null;
}

export function opaqueKindOf(upload: {
  publicId: string;
  opaqueKind?: OpaqueBlobKind | null;
}): OpaqueBlobKind | null {
  return upload.opaqueKind ?? opaqueKindFromPublicId(upload.publicId);
}

export function cloudinaryResourceTypeFor(upload: {
  publicId: string;
  resourceType: 'IMAGE' | 'VIDEO';
  opaqueKind?: OpaqueBlobKind | null;
}): 'image' | 'video' | 'raw' {
  if (opaqueKindOf(upload)) {
    return 'raw';
  }

  return upload.resourceType === 'IMAGE' ? 'image' : 'video';
}

// what Cloudinary returns as secure_url for a raw asset with no extension
export function rawDeliveryUrl(params: {
  cloudName: string;
  version: number;
  publicId: string;
}): string {
  return `https://res.cloudinary.com/${params.cloudName}/raw/upload/v${params.version}/${params.publicId}`;
}
