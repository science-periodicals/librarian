import assert from 'assert';
import { getJournalHostname } from '../src';

describe('getJournalHostname', function() {
  it('should return undefined if no hostname is available', () => {
    assert.equal(getJournalHostname(), undefined);
  });

  it('should return the hostname if hostname is a journal hostname', () => {
    assert.equal(getJournalHostname({ hostname: 'sci.pe' }), undefined);
    assert.equal(
      getJournalHostname({ hostname: 'research.sci.pe' }),
      'research.sci.pe'
    );
  });

  it('should return the hostname on localhost if a journal hostname is passed as a query string parameter', () => {
    assert.equal(
      getJournalHostname({
        hostname: '127.0.0.1',
        query: { hostname: 'sci.pe' }
      }),
      undefined
    );
    assert.equal(
      getJournalHostname({
        hostname: '127.0.0.1',
        query: { hostname: 'research.sci.pe' }
      }),
      'research.sci.pe'
    );
  });
});
