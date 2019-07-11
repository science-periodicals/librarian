import assert from 'assert';
import { getLocationIdentifier } from '../src';

describe('workflow-utils', function() {
  describe('getLocationIdentifier', () => {
    it('should return unique identifier', () => {
      const props = [
        'actionStatus',
        'description',
        'expectedDuration',
        'encoding',
        'releaseNotes',
        'programmingLanguage',
        'isBasedOn',
        'hasPart',
        'comment',
        'text',
        'distribution',
        'result',
        'object',
        'revisionType',
        'resultReason',
        //'result.slug',
        'slug', // shortcut (context should never matter as `slug` is not an action property)
        //'result.datePublished',
        'datePublished', // shortcut (context should never matter as `datePublished` is not an action property)
        'requestedPrice',
        'instrument',
        'question',
        'annotation',
        'citation',
        'about',
        'license',
        'alternateName',
        'caption',
        'funder',
        'headline',
        'detailedDescription',
        'answer',
        // !! context may matter for `parentItem`
        'parentItem',
        'answer.parentItem',
        'resultReview',
        // !! context may matter for `reviewRating`
        'reviewRating',
        'resultReview.reviewRating',
        // !! context may matter for `reviewBody`
        'reviewBody',
        'resultReview.reviewBody',
        'potentialAction'
      ];

      const identifiers = props.map(p =>
        getLocationIdentifier('DeclareAction', p)
      );
      assert.equal(identifiers.length, new Set(identifiers).size);
    });
  });
});
