import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getServiceByServiceOutputId(serviceOutputId, callback) {
  this.view.get(
    {
      url: '/serviceByServiceOutputId',
      qs: {
        key: JSON.stringify(getId(serviceOutputId)),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      callback(null, getDocs(body)[0]);
    }
  );
}
