import assert from 'assert';
import {
  getFacebookShareUrl,
  getTwitterShareUrl,
  getRedditShareUrl,
  getLinkedInShareUrl,
  getEmailShareUrl
} from '../src';

describe('share', () => {
  describe('facebook', () => {
    it('should generate a facebook share URL', () => {
      const url = getFacebookShareUrl({ url: 'http://example.com' });
      assert.equal(typeof url, 'string');
    });
  });

  describe('twitter', () => {
    it('should generate a twitter share URL', () => {
      const url = getTwitterShareUrl({ url: 'http://example.com' });
      assert.equal(typeof url, 'string');
    });
  });

  describe('reddit', () => {
    it('should generate a reddit share URL', () => {
      const url = getRedditShareUrl({ url: 'http://example.com' });
      assert.equal(typeof url, 'string');
    });
  });

  describe('email', () => {
    it('should generate am email share URL', () => {
      const url = getEmailShareUrl({
        url: 'http://example.com',
        description: 'a resource'
      });
      assert.equal(typeof url, 'string');
    });
  });

  describe('linkedin', () => {
    it('should generate a linked in share URL', () => {
      const url = getLinkedInShareUrl({ url: 'http://example.com' });
      assert.equal(typeof url, 'string');
    });
  });
});
