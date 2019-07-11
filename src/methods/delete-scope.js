import flagDeleted from '../utils/flag-deleted';

export default function deleteScope(scopeId, { store, force } = {}, callback) {
  this.getScopeDocs(scopeId, { store }, (err, docs) => {
    if (err) return callback(err);
    this.put(
      docs.map(doc => flagDeleted(doc)),
      { store, force, deleteBlobs: false },
      (err, deletedDocs) => {
        if (err) return callback(err);
        this.blobStore.delete(
          {
            graphId: scopeId,
            resourceId: null,
            encodingId: null
          },
          err => {
            if (err) {
              this.log.warn(err, `error deleting blobs for ${scopeId}`);
            }

            callback(null, deletedDocs);
          }
        );
      }
    );
  });
}
