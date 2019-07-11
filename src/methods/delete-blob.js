// Convenience blob store wrapper so that we have promise support (see high.hs)

export default function deleteBlob(
  { graphId, resourceId, encodingId },
  callback
) {
  this.blobStore.delete(
    {
      graphId,
      resourceId,
      encodingId
    },
    callback
  );
}
