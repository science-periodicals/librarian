import createError from '@scipe/create-error';
import { getId, getNodeMap, arrayify, dearrayify } from '@scipe/jsonld';
import { getDocs } from '../low';
import getScopeId from '../utils/get-scope-id';

/**
 * Used by the API to provide access to encoding content before it has been
 * merged to a Graph (e.g as part of an UploadAction or UpdateAction)
 */
export default function getPendingEncodingByContentUrl(
  contentUrl,
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  this.view.get(
    {
      url: '/pendingEncodingsByContentUrl',
      qs: {
        key: JSON.stringify(contentUrl),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const action = getDocs(body)[0];
      // if defined action is either an UpdateAction or an UploadAction

      if (action) {
        let encoding;

        if (action['@type'] === 'UploadAction') {
          encoding = action.result;
        } else if (
          action['@type'] === 'UpdateAction' &&
          action.object &&
          action.object['@graph']
        ) {
          const nodes = arrayify(action.object['@graph']);
          const nodeMap = getNodeMap(nodes);
          const node = nodes.find(node => node.contentUrl === contentUrl);

          // re-embed contentChecksum
          if (node.contentChecksum) {
            node.contentChecksum = dearrayify(
              node.contentChecksum,
              arrayify(node.contentChecksum).map(contentChecksumId => {
                return nodeMap[getId(contentChecksumId)] || contentChecksumId;
              })
            );
          }

          encoding = node;
        }

        if (encoding) {
          return callback(
            null,
            // set `isNodeOf` so that the scope is defined
            Object.assign({ isNodeOf: getScopeId(action) }, encoding)
          );
        }
      }

      return callback(
        createError(
          404,
          `getPendingEncodingByContentUrl: Not found (${contentUrl})`
        )
      );
    }
  );
}
