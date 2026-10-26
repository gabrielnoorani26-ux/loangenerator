/** Which page a batch opens to, by status (client-safe copy of the routing rule). */
export function batchHrefFor(b: { id: string; status: string; totalImages: number }): string {
  switch (b.status) {
    case "DRAFT":
      return b.totalImages > 0 ? `/batches/${b.id}/settings` : `/batches/${b.id}/upload`;
    case "READY":
      return `/batches/${b.id}/settings`;
    case "PROCESSING":
    case "PAUSED":
      return `/batches/${b.id}/processing`;
    default:
      return `/batches/${b.id}/review`;
  }
}
