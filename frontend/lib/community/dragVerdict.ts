export interface DragVerdict {
  /** Whether a drop here would add the files. */
  ok: boolean;
  message: string;
}

interface DraggedItem {
  kind: string;
  type: string;
}

/**
 * What to tell someone who is dragging files over the room, from what the browser reveals mid-drag
 * (the kind and type of each item, never the names). Null when no file is being dragged.
 */
export function dragVerdict(
  items: ArrayLike<DraggedItem> | undefined,
  roomLeft: number,
  acceptedTypes: string[],
): DragVerdict | null {
  const files = Array.from(items ?? []).filter((item) => item.kind === "file");
  if (files.length === 0) return null;

  // An empty type means the browser could not tell, not that the file is wrong.
  if (files.some((file) => file.type && !acceptedTypes.includes(file.type))) {
    return { ok: false, message: "This file type is not supported. Use JPG, PNG, WebP or GIF." };
  }
  if (roomLeft <= 0) {
    return { ok: false, message: "This message already has the most images it can hold." };
  }
  if (files.length > roomLeft) {
    return { ok: true, message: `Drop to add images. Only ${roomLeft} more fit in one message.` };
  }
  return { ok: true, message: files.length === 1 ? "Drop to add this image" : `Drop to add ${files.length} images` };
}
