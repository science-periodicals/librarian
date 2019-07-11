import { getCreativeWorkTypeFromMime, getEncodingTypeFromMime } from '../src';
import assert from 'assert';

describe('mime-utils', function() {
  describe('getCreativeWorkTypeFromMime', function() {
    it('should get a CreativeWork @type from a MIME', function() {
      assert.equal(
        getCreativeWorkTypeFromMime(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ),
        'ScholarlyArticle'
      );
    });
  });

  describe('getEncodingTypeFromMime', function() {
    it('should get an encoding @type from a MIME', function() {
      assert.equal(
        getEncodingTypeFromMime(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ),
        'DocumentObject'
      );
    });
  });
});
