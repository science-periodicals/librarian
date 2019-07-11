import { Librarian } from '../../';

export default function deleteId(id, config, callback) {
  const librarian = new Librarian(config);
  librarian.delete(
    id,
    {
      acl: false
    },
    callback
  );
}
