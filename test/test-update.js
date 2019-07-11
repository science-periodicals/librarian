import assert from 'assert';
import uuid from 'uuid';
import { Librarian, createId } from '../src';

describe('update method', function() {
  this.timeout(40000);

  let librarian, doc;

  before(async () => {
    librarian = new Librarian();

    doc = await librarian.put(
      Object.assign(createId('graph', uuid.v4()), {
        '@type': 'Graph'
      })
    );
  });

  it('should automatically handle conflict', async () => {
    const [upd1, upd2] = await Promise.all([
      librarian.update(
        doc,
        doc => {
          return Object.assign({}, doc, { name: 'name1' });
        },
        { ifMatch: null }
      ),
      librarian.update(
        doc,
        doc => {
          return Object.assign({}, doc, { name: 'name2' });
        },
        { ifMatch: null }
      )
    ]);

    // one of the update will win and overwrite the other but there will be no confilct, so both "succeed"
    assert.equal(upd1['@type'], 'Graph');
    assert.equal(upd2['@type'], 'Graph');
  });
});
