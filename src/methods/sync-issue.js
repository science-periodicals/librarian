import pick from 'lodash/pick';
import { getNodeMap, arrayify, getId } from '@scipe/jsonld';
import getScopeId from '../utils/get-scope-id';
import createId from '../create-id';

/**
 * Add the issue @id in the 'isPartof' prop all the relevant latest releases.
 * Note: if issue is deleted (issue._deleted is true), the issue @id will be removed from the `isPartOf` prop of all the relevant latest releases.
 */
export default async function syncIssue(issue, { store } = {}) {
  const releases = await this.getLatestReleasesByIssueId(issue, { store });
  const releaseMap = getNodeMap(releases);

  if (issue['@type'] === 'PublicationIssue') {
    // add graphs matching by time (in case the temporal coverage was changed)
    const releases = await this.getLatestReleasesCoveredByIssue(issue, {
      store
    });

    Object.assign(releaseMap, getNodeMap(releases));
  } else if (issue['@type'] === 'SpecialPublicationIssue') {
    // add the release from the issue
    // !! SpecialPublicationIssue  has the latest graphs with `?version=latest` => we recreate the latest _id
    const releases = await this.get(
      arrayify(issue.hasPart).map(
        graph => createId('release', 'latest', graph, true)._id
      ),
      { store, acl: false }
    );
    Object.assign(releaseMap, getNodeMap(releases));
  }

  // get a list of release to update
  const toUpdate = [];
  Object.keys(releaseMap)
    .map(key => releaseMap[key])
    .forEach(release => {
      if (
        arrayify(release.isPartOf).some(
          _issue => getId(_issue) === getId(issue)
        )
      ) {
        if (issue._deleted) {
          // we will need to _remove_ the issueId
          toUpdate.push(release);
        }
      } else {
        if (!issue._deleted) {
          // we will need to _add_ the issueId
          toUpdate.push(release);
        }
      }
    });

  if (!toUpdate.length) {
    return [];
  }

  const updatedReleases = [];
  for (const release of toUpdate) {
    const updatedRelease = await this.update(
      release,
      release => {
        const journalId = getScopeId(issue);

        if (issue._deleted) {
          // remove issue
          release.isPartOf = arrayify(release.isPartOf).filter(
            _issue => getId(_issue) !== getId(issue)
          );
          if (!release.isPartOf.length) {
            release.isPartOf = journalId;
          } else if (release.isPartOf.length === 1) {
            release.isPartOf = release.isPartOf[0];
          }
        } else {
          // add issue
          // be sure to replace journal entry by the issue one if a journal entry exists
          release.isPartOf = arrayify(release.isPartOf)
            .filter(
              _issue =>
                getId(_issue) !== getId(issue) && getId(_issue) !== journalId
            )
            .concat(
              Object.assign(
                { isPartOf: journalId },
                pick(issue, ['@id', 'isPartOf'])
              )
            );

          if (release.isPartOf.length === 1) {
            release.isPartOf = release.isPartOf[0];
          }
        }

        return release;
      },
      { store }
    );
    updatedReleases.push(updatedRelease);
  }

  return updatedReleases;
}
