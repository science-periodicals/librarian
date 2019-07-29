// Low level API

import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import util from 'util';
import redis from 'redis';
import request from 'request';
import juice from 'juice';
import AWS from 'aws-sdk';
import uuid from 'uuid';
import uniq from 'lodash/uniq';
import reEmail from 'regex-email';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { arrayify, getValue, textify, unrole, unprefix } from '@scipe/jsonld';
import toMarkdown from './utils/to-markdown';
import createCouchClient from './utils/create-couch-client';
import {
  EMAIL_MESSAGE_SENDER,
  CONTACT_POINT_ADMINISTRATION
} from './constants';
import addPromiseSupport from './utils/add-promise-support';

AWS.config.update({ region: process.env.AWS_REGION });

const css = fs.readFileSync(path.join(__dirname, '../templates/style.css'), {
  encoding: 'utf8'
});

/**
 * !! when opts.authHeaders is used, if authHeaders are then invalidated by a logout for instance, a new db should be created
 */
export function createDb(config = {}, opts = {}) {
  // validation
  if (opts.view && opts.search) {
    throw new Error('search and view options are mutualy exclusive');
  }
  if ((opts.view || opts.search) && !opts.ddoc) {
    throw new Error(
      'search or view options must be used along with the ddoc option'
    );
  }

  let baseUrl = getBaseUrl(config);
  if (opts.replicate) {
    baseUrl += '_replicate';
  } else {
    baseUrl += getDbName(config);

    if (opts.ddoc) {
      baseUrl += `/_design/${opts.ddoc}`;
    }
    if (opts.ddoc && opts.view) {
      baseUrl += '/_view';
    }
    if (opts.ddoc && opts.search) {
      baseUrl += '/_search';
    }
  }

  const defaults = {
    baseUrl: baseUrl
  };
  if (opts.admin) {
    defaults.auth = getAdminAuthHeaders(config);
  }
  if (opts.authHeaders) {
    defaults.headers = opts.authHeaders;
  }

  return createCouchClient(request.defaults(defaults), config, opts.logger);
}

export function createAuthDb(config = {}, opts = {}) {
  if (opts.view && !opts.ddoc) {
    throw new Error(' view options must be used along with the ddoc option');
  }

  let baseUrl = getBaseUrl(config) + getAuthDb(config);
  if (opts.ddoc) {
    baseUrl += `/_design/${opts.ddoc}`;
  }
  if (opts.ddoc && opts.view) {
    baseUrl += '/_view';
  }

  return createCouchClient(
    request.defaults({
      baseUrl,
      auth: getAdminAuthHeaders(config)
    }),
    config,
    opts.logger
  );
}

export function getBaseUrl(config = {}, opts = {}) {
  let creds;
  if (opts.basicAuth) {
    const { user, pass } = getAuthHeaders(config);
    creds = `${user}:${pass}@`;
  } else if (opts.admin) {
    const { user, pass } = getAdminAuthHeaders(config);
    creds = `${user}:${pass}@`;
  }

  return util.format(
    '%s//%s%s:%d/',
    config.couchProtocol || process.env.COUCH_PROTOCOL || 'http:',
    creds || '',
    config.couchHost || process.env.COUCH_HOST || '127.0.0.1',
    config.couchPort || process.env.COUCH_PORT || 5984
  );
}

export function getDbName(config = {}) {
  return config.dbName || process.env.DB_NAME || 'scienceai';
}

export function getAuthDb(config = {}) {
  return config.couchAuthDb || process.env.COUCH_AUTH_DB || '_users';
}

export function getApiBaseUrl(config = {}, opts = {}) {
  let creds;
  if (opts.basicAuth) {
    const { user, pass } = getAuthHeaders(config);
    creds = `${user}:${pass}@`;
  } else if (opts.admin) {
    const { user, pass } = getAdminAuthHeaders(config);
    creds = `${user}:${pass}@`;
  }

  return util.format(
    '%s//%s%s:%d',
    config.apiProtocol || process.env.API_PROTOCOL || 'http:',
    creds || '',
    config.apiHost || process.env.API_HOST || '127.0.0.1',
    config.apiPort || process.env.API_PORT || 3000
  );
}

export function isCloudant(config) {
  return getBaseUrl(config).indexOf('cloudant') !== -1;
}

export function getAuthHeaders(config = {}) {
  return {
    user: config.couchUsername,
    pass: config.couchPassword
  };
}

export function getAdminAuthHeaders(config = {}) {
  return {
    user:
      config.couchAdminUsername || process.env.COUCH_ADMIN_USERNAME || 'admin',
    pass:
      config.couchAdminPassword || process.env.COUCH_ADMIN_PASSWORD || 'admin'
  };
}

export function getApiAdminAuthHeaders(config = {}) {
  return {
    user: config.apiAdminUsername || process.env.API_ADMIN_USERNAME || 'admin',
    pass: config.apiAdminPassword || process.env.API_ADMIN_PASSWORD || 'admin'
  };
}

export function getRedisConfig(config = {}, params = {}) {
  const opts = {
    host: config.redisHost || process.env['REDIS_HOST'] || '127.0.0.1',
    port: config.redisPort || process.env['REDIS_PORT'] || 6379
  };
  const redisPrefix = params.prefix || config.redisPrefix;
  if (redisPrefix) {
    opts.prefix = redisPrefix;
  }
  const redisPassword = config.redisPassword || process.env['REDIS_PASSWORD'];
  if (redisPassword) {
    opts.pass = redisPassword; // for compatibility with RedisStore (used in the session middleware)
    opts.password = redisPassword;
  }

  // needed for rate limiter
  const redisOfflineQueue =
    'redisOfflineQueue' in params
      ? params.redisOfflineQueue
      : redisOfflineQueue in config
      ? config.redisOfflineQueue
      : undefined;

  if (redisOfflineQueue != null) {
    opts.enable_offline_queue = redisOfflineQueue;
  }

  return opts;
}

export function createRedisClient(config = {}, params = {}) {
  return redis.createClient(getRedisConfig(config, params));
}

export function createEmailClient(config = {}) {
  // TODO if emailService is not 'ses' we just mock the ses client
  if (!config.emailService) {
    return addPromiseSupport(function(emailMessage, callback) {
      callback(null, {
        MessageId: uuid.v4()
      });
    });
  }

  const ses = config.ses || new AWS.SES();
  const root = path.join(__dirname, '../templates/');
  const emailTemplate = ejs.render(
    `<!DOCTYPE html>
<html>
  <body>
    <script type="application/ld+json">{{___JSON-LD___}}</script>
    <%- include('/header'); %>
    {{___TEXT___}}
    <%- include('/footer'); %>
  </body>
</html>`,
    {},
    { root }
  );

  return addPromiseSupport(function(emailMessage, callback) {
    if (!emailMessage) {
      return callback(createError(400, 'invalid email message'));
    }

    // we provide default value for subject and sender but we do need valid recipients
    const recipients = arrayify(emailMessage.recipient);
    if (
      !recipients.length ||
      !recipients.every(recipient => {
        recipient = unrole(recipient, 'recipient');
        return (
          recipient &&
          ((recipient.email && reEmail.test(unprefix(recipient.email))) ||
            arrayify(recipient.contactPoint).some(cp => {
              return (
                cp &&
                cp.contactType === CONTACT_POINT_ADMINISTRATION &&
                cp.email
              );
            }))
        );
      })
    ) {
      this.log.error(
        { emailMessage },
        'createEmailClient: invalid email message recipient'
      );
      return callback(createError(400, 'invalid email message recipient'));
    }

    let body;
    if (emailMessage.text && emailMessage.text['@type'] === 'rdf:HTML') {
      body = {
        Html: {
          Data: juice.inlineContent(
            emailTemplate
              .replace('{{___JSON-LD___}}', JSON.stringify(emailMessage))
              .replace('{{___TEXT___}}', getValue(emailMessage.text) || ''),
            css
          )
        },
        Text: {
          Data: toMarkdown(getValue(emailMessage.text) || '')
        }
      };
    } else {
      body = {
        Text: {
          Data: toMarkdown(getValue(emailMessage.text) || '')
        }
      };
    }

    let source;
    const sender = unrole(emailMessage.sender, 'sender');
    let senderEmail = sender && sender.email;
    if (sender && !senderEmail) {
      const contactPoint = arrayify(sender.contactPoint).find(cp => {
        return (
          cp && cp.contactType === CONTACT_POINT_ADMINISTRATION && cp.email
        );
      });
      if (contactPoint) {
        senderEmail = contactPoint.email;
      }
    }

    if (sender && senderEmail) {
      if (sender.alternateName || sender.name) {
        source = `${sender.alternateName || sender.name} <${unprefix(
          senderEmail
        )}>`;
      } else {
        source = unprefix(senderEmail);
      }
    } else {
      source = `sci.pe <${EMAIL_MESSAGE_SENDER}>`;
    }

    // See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SES.html#sendEmail-property
    const recipientEmails = uniq(
      arrayify(emailMessage.recipient).map(recipient => {
        const unroled = unrole(recipient, 'recipient');
        // Note recipient were already validated so we know that email is defined
        return unprefix(
          unroled.email ||
            arrayify(unroled.contactPoint).find(cp => {
              return (
                cp &&
                cp.contactType === CONTACT_POINT_ADMINISTRATION &&
                cp.email
              );
            }).email
        );
      })
    );

    const params = {
      Destination: {
        // `BccAddresses` instead of `ToAddresses` to avoid leaking identities
        [recipientEmails.length > 1
          ? 'BccAddresses'
          : 'ToAddresses']: recipientEmails
      },
      Message: {
        Body: body,
        Subject: {
          Data:
            textify(getValue(emailMessage.description)) ||
            '[sci.pe] notification' // AWS SES makes the email subject required
        }
      },
      Source: source
    };

    ses.sendEmail(params, callback);
  });
}

export function mapChangeToSchema(change) {
  const { doc } = change;
  const dataFeedItem = {
    '@id': `seq:${change.seq}`,
    '@type': 'DataFeedItem',
    item: doc
  };

  const dateCreated = doc.dateCreated || doc.startTime || doc.startDate;

  if (dateCreated) {
    dataFeedItem.dateCreated = dateCreated;
  } else if (parseIndexableString(doc._id)[1] === 'profile' && doc.memberOf) {
    const memberOfScienceAi = (Array.isArray(doc.memberOf)
      ? doc.memberOf
      : [doc.memberOf]
    ).filter(memberOf => {
      return (
        memberOf.startDate &&
        doc.memberOf.memberOf &&
        (Array.isArray(doc.memberOf.memberOf)
          ? doc.memberOf.memberOf
          : [doc.memberOf.memberOf]
        ).some(function(memberOf) {
          var memberOfId = memberOf['@id'] || memberOf;
          return memberOfId === 'https://sci.pe' || memberOfId === 'org:scipe';
        })
      );
    })[0];
    if (memberOfScienceAi) {
      dataFeedItem.dateCreated = memberOfScienceAi.startDate;
    }
  }

  const dateModified = doc.dateModified || doc.endTime || doc.endDate;
  if (dateModified) {
    dataFeedItem.dateModified = dateModified;
  }

  if (change.deleted && doc.dateDeleted) {
    dataFeedItem.dateDeleted = doc.dateDeleted;
  }

  return dataFeedItem;
}

export function getDocs(body) {
  return arrayify(body.rows)
    .filter(row => row.doc)
    .map(row => row.doc);
}

export function getSocketIdentity(action = {}) {
  return `${action['@type'] || 'Action'}-client-${uuid.v4()}`;
}
