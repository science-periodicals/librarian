import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getProfilesByMemberOfId(memberOfId, callback) {
  this.view.get(
    {
      url: '/profileByMemberOfId',
      qs: {
        key: JSON.stringify(getId(memberOfId)),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      const profiles = getDocs(body);
      callback(null, profiles);
    }
  );
}
