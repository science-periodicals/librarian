import { RE_LOCAL_HOST_OR_DEV } from './constants';

export default function(req = {}) {
  // to help local development we allow to pass hostname as a qs
  const hostname = RE_LOCAL_HOST_OR_DEV.test(req.hostname)
    ? req.query.hostname
    : req.hostname;

  if (hostname && hostname !== 'sci.pe' && hostname !== 'www.sci.pe') {
    return hostname;
  }
}
