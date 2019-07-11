#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import util from 'util';
import colors from 'colors'; // eslint-disable-line
import asyncEach from 'async/each';
import createError from '@scipe/create-error';
import { getId, arrayify, unprefix } from '@scipe/jsonld';
import secure from './lib/secure';
import register from './lib/register';
import createOrganization from './lib/create-organization';
import createPeriodical from './lib/create-periodical';
import createAuthenticationToken from './lib/create-authentication-token';
import resetRedis from './lib/reset-redis';
import seedServices from './lib/seed-services';
import processStory from './lib/process-story';
import addRole from './lib/add-role';
import removeRole from './lib/remove-role';
import deleteId from './lib/delete-id';
import warmup from './lib/warmup';
import {
  createDb,
  getBaseUrl,
  getDbName,
  getAuthDb,
  Librarian,
  SCIPE_FREE_OFFER_ID,
  SCIPE_EXPLORER_OFFER_ID,
  SCIPE_VOYAGER_OFFER_ID,
  createId
} from '../';

/* eslint-disable no-console */

const argv = yargs
  .usage(
    `Usage: librarian <command> [options] where command is:
    - warmup [-c, --config] [-q, --quiet]
    - add-role [-u, --user] [-r, --role] [-c, --config]
    - remove-role [-u, --user] [-r, --role] [-c, --config]
    - register [-u, --user] [-p, --password] [-e, --email] [-c, --config] [-r, --role]
    - create-organization [-u, --user] [-p, --password] [-e, --email] [-i, --id] [-n, --name] [-c, --config]
    - create-periodical [-u, --user] [-p, --password] [-n, --name] [-o, --organization] [-c, --config]
    - create-authentication-token <user> [-u, --user] [-p, --password] [-c, --config]
    - secure [-d, --db] [-c, --config]
    - reset-redis [-k, --key] [-c, --config]
    - reset-cache [-c, --config]
    - seed-services [-c, --config]
    - delete [-i, --id] [-c, --config]
    - post [path/to/story.json (if omitted will be read from stdin (pipe)] [-c, --config] [-q, --quiet] [--start] [--end]
    - get [-i, --id] [-u, --user] [-c, --config]
    - replicate-db <path/to/target-config.json> [-c, --config]
    - delete-stripe-account [-i, --id] [-c, --config]
    - subscribe [-u, --user] [-o, --organization] [--plan] [-c, --config]
  `
  )
  .alias('u', 'user')
  .describe('u', 'username')
  .alias('p', 'password')
  .describe('p', 'password')
  .alias('r', 'role')
  .describe('r', 'role')
  .alias('e', 'email')
  .describe('e', 'email')
  .alias('t', 'type')
  .describe('t', 'type')
  .alias('o', 'organization')
  .describe('o', 'organization')
  .coerce('o', function(id) {
    return createId('org', unprefix(id))['@id'];
  })
  .alias('n', 'name')
  .describe('n', 'name')
  .alias('j', 'data')
  .describe('j', 'data (in JSON)')
  .alias('h', 'help')
  .describe('h', 'print usage')
  .alias('d', 'domain')
  .alias('d', 'db')
  .describe('d', 'database or domain name')
  .alias('c', 'config')
  .describe('c', 'path to JSON config')
  .alias('k', 'key')
  .describe('k', 'redis key (or prefix)')
  .alias('i', 'id')
  .describe('i', 'id')
  .alias('v', 'version')
  .describe('v', 'print version number')
  .alias('l', 'level')
  .describe('l', 'log level')
  .alias('q', 'quiet')
  .describe('q', 'quiet')

  .describe('start', 'start offset (0 based, starting from, included)')
  .coerce('start', arg => parseInt(arg, 10))
  .describe('end', 'end offset (0 based, up to but not included)')
  .coerce('end', arg => parseInt(arg, 10))

  .default('l', 'error')

  .describe('plan', 'plan')
  .choices('plan', ['free', 'explorer', 'voyager'])

  // convenience variable for config overwrite
  .describe('blob-storage-backend', 'blob store engine')
  .choices('blob-storage-backend', ['S3', 'fs'])
  .describe('fs-blob-store-root', 'root directory for the fs blob store engine')
  .describe('s3-blob-store-root', 'bucket for S3 blob store engine')

  .describe('redis-port', 'Redis port')
  .describe('redis-host', 'Redis host')
  .describe('redis-password', 'Redis password')

  .describe('couch-protocol', 'Couch protocol')
  .describe('couch-host', 'Couch host')
  .describe('couch-port', 'Couch port')
  .describe('couch-admin-username', 'Couch admin username')
  .describe('couch-admin-password', 'Couch admin password')
  .describe('db-name', 'DB name')

  .describe('stripe-key', 'Stripe key')

  .help('h').argv;

if (argv.v) {
  console.log(require('../../package.json').version);
  process.exit(0);
}

// All command can specify a config
let config = {};
if (argv.c) {
  const configPath = path.resolve(process.cwd(), argv.c);
  try {
    config = JSON.parse(fs.readFileSync(configPath));
  } catch (err) {
    console.error(argv._[0].grey + ' ERR! '.red + err.message);
    process.exit(1);
  }
}

config = Object.assign({}, config, {
  blobStorageBackend: argv['blob-storage-backend'],
  fsBlobStoreRoot: argv['fs-blob-store-root'],
  s3BlobStoreRoot: argv['s3-blob-store-root'],

  redisPort: argv['redis-port'],
  redisHost: argv['redis-host'],
  redisPassword: argv['redis-password'],

  couchProtocol: argv['couch-protocol'],
  couchHost: argv['couch-host'],
  couchPort: argv['couch-port'],
  couchAdminUsername: argv['couch-admin-username'],
  couchAdminPassword: argv['couch-admin-password'],
  dbName: argv['db-name'],

  stripeKey: argv['stripe-key'],

  log:
    config.log || argv.l
      ? Object.assign({}, config.log, argv.l ? { level: argv.l } : undefined)
      : undefined
});

switch (argv._[0]) {
  case 'warmup':
    warmup(config, { verbose: !argv.q }, err => {
      if (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      }
      process.exit(0);
    });
    break;

  case 'post': {
    let story;
    if (argv._[1]) {
      const storyPath = path.resolve(process.cwd(), argv._[1]);
      try {
        story = JSON.parse(fs.readFileSync(storyPath));
      } catch (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      }
      processStory(
        argv._[0],
        story,
        config,
        {
          verbose: !argv.q,
          start: argv.start,
          end: argv.end
        },
        err => {
          if (err) {
            // Note: we don't use the exit code to communicate the rety index as
            // it can be limited to value from 0 -> 255
            console.error(err.retryIndex);
          }
          process.exit(err ? 1 : 0);
        }
      );
    } else {
      // we get story through stdin
      process.stdin.setEncoding('utf8');
      story = '';

      process.stdin.on('readable', () => {
        const chunk = process.stdin.read();
        if (chunk !== null) {
          story += chunk;
        }
      });

      process.stdin.on('end', () => {
        try {
          story = JSON.parse(story);
        } catch (err) {
          console.error(argv._[0].grey + ' ERR! '.red + err.message);
          process.exit(1);
        }

        processStory(
          argv._[0],
          story,
          config,
          { verbose: !argv.q, start: argv.start, end: argv.end },
          err => {
            if (err) {
              console.error(err.retryIndex);
            }
            process.exit(err ? 1 : 0);
          }
        );
      });
    }

    break;
  }

  case 'get': {
    const librarian = new Librarian(config);
    const acl = argv.u ? `user:${unprefix(argv.u)}` : false;
    librarian.get(argv.i, { acl }, (err, doc) => {
      if (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      }
      console.log(util.inspect(doc, { depth: null }));
      console.log(`acl: ${acl}`);
      process.exit(0);
    });
    break;
  }

  // replicate the DB specified by `config` to the  DB specified by `targetConfig`
  case 'replicate-db': {
    const targetConfigPath = path.resolve(process.cwd(), argv._[1]);
    try {
      var targetConfig = JSON.parse(fs.readFileSync(targetConfigPath));
    } catch (err) {
      console.error(argv._[0].grey + ' ERR! '.red + err.message);
      process.exit(1);
    }

    // See https://console.bluemix.net/docs/services/Cloudant/api/replication.html#replication
    const db = createDb(config, { replicate: true, admin: true });

    const docs = [
      {
        source: `${getBaseUrl(config, { admin: true })}${getDbName(config)}`,
        target: `${getBaseUrl(targetConfig, { admin: true })}${getDbName(
          targetConfig
        )}`,
        create_target: true
      },
      {
        source: `${getBaseUrl(config, { admin: true })}${getAuthDb(config)}`,
        target: `${getBaseUrl(targetConfig, { admin: true })}${getAuthDb(
          targetConfig
        )}`,
        create_target: true
      }
    ];

    console.log(argv._[0].grey + ' POSTing to /_replicate');
    asyncEach(
      docs,
      (doc, cb) => {
        console.log(doc);

        db.post(
          {
            url: '/',
            json: doc
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return cb(err);
            }
            console.log(body);
            cb(null);
          }
        );
      },
      err => {
        if (err) {
          console.error(argv._[0].grey + ' ERR! '.red + err.message);
          process.exit(1);
        }
        console.log(argv._[0].grey + ' ✓ '.green);
        process.exit(0);
      }
    );

    break;
  }

  case 'add-role': {
    addRole({ username: argv.u, role: argv.r }, config, (err, body) => {
      console.log(argv._[0].grey + ' + '.green + argv.r + ' (' + argv.u + ')');
      process.exit(0);
    });
    break;
  }

  case 'remove-role': {
    removeRole({ username: argv.u, role: argv.r }, config, (err, body) => {
      console.log(argv._[0].grey + ' - '.red + argv.r + ' (' + argv.u + ')');
      process.exit(0);
    });
    break;
  }

  case 'register':
    register(
      {
        username: argv.u,
        password: argv.p,
        email: argv.e,
        role: argv.r
      },
      config,
      (err, registerAction) => {
        if (err) {
          console.error(argv._[0].grey + ' ERR! '.red + err.message);
          process.exit(1);
        } else {
          console.log(
            argv._[0].grey +
              ' + '.green +
              getId(
                arrayify(registerAction.result).find(
                  result => result['@type'] === 'Person'
                )
              ) +
              ' (' +
              argv.u +
              ')'
          );
          process.exit(0);
        }
      }
    );
    break;

  case 'create-org':
  case 'create-organization': {
    createOrganization(
      {
        username: argv.u,
        password: argv.p,
        organizationId: argv.i,
        organizationEmail: argv.e,
        organizationName: argv.n
      },
      config,
      (err, createOrganizationAction) => {
        if (err) {
          console.error(argv._[0].grey + ' ERR! '.red + err.message);
          process.exit(1);
        } else {
          const organization = arrayify(createOrganizationAction.result).find(
            result => result['@type'] === 'Organization'
          );
          console.log(
            argv._[0].grey +
              ' + '.green +
              getId(organization) +
              (organization.name ? ' (' + organization.name + ')' : '')
          );
          process.exit(0);
        }
      }
    );
    break;
  }

  case 'create-journal':
  case 'create-periodical': {
    createPeriodical(
      {
        username: argv.u,
        password: argv.p,
        organizationId: argv.o,
        journalName: argv.n
      },
      config,
      (err, createPeriodicalAction) => {
        if (err) {
          console.error(argv._[0].grey + ' ERR! '.red + err.message);
          process.exit(1);
        } else {
          const periodical = arrayify(createPeriodicalAction.result).find(
            result => result['@type'] === 'Periodical'
          );
          console.log(
            argv._[0].grey +
              ' + '.green +
              getId(periodical) +
              ' (' +
              periodical.name +
              ')'
          );
          process.exit(0);
        }
      }
    );
    break;
  }

  case 'create-authentication-token':
    createAuthenticationToken(
      {
        username: argv.u,
        password: argv.p,
        proxyUserId: argv._[1]
      },
      config,
      (err, createAuthenticationTokenAction) => {
        if (err) {
          console.error(argv._[0].grey + ' ERR! '.red + err.message);
          process.exit(1);
        } else {
          const token = createAuthenticationTokenAction.result;
          console.log(
            argv._[0].grey +
              ' + '.green +
              token.value +
              ' (for ' +
              argv._[1] +
              ' )'
          );
          process.exit(0);
        }
      }
    );
    break;

  case 'secure': {
    const dbs = argv.d
      ? arrayify(argv.d)
      : [getDbName(config), getAuthDb(config)];

    secure(dbs, config, err => {
      if (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      }
      console.log(argv._[0].grey + ' secured'.green + ': ' + dbs.join(', '));
    });
    break;
  }

  case 'reset-redis': {
    const keys = argv.k
      ? arrayify(argv.k)
      : [
          `${getDbName(config)}:sess:*`,
          `${getDbName(config)}:locks:*`,
          `${getDbName(config)}:seenset`,
          `${getDbName(config)}:seqset`,
          `${getDbName(config)}:tokens:*`,
          `${getDbName(config)}:cache:*`,
          `${getDbName(config)}:uid`, // uniq ids
          `${getDbName(config)}:wid:*` // workflow action ids
        ];

    resetRedis(keys, config, (err, res) => {
      if (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      }
      console.log(
        argv._[0].grey +
          ' deleted'.green +
          ': ' +
          keys.join(', ') +
          ' (' +
          res +
          ')'
      );
      process.exit(0);
    });
    break;
  }

  case 'reset-cache': {
    const keys = [`${getDbName(config)}:cache:*`];

    resetRedis(keys, config, (err, res) => {
      if (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      }
      console.log(
        argv._[0].grey +
          ' deleted'.green +
          ': ' +
          keys.join(', ') +
          ' (' +
          res +
          ')'
      );
      process.exit(0);
    });
    break;
  }

  case 'seed-services': {
    seedServices(config, (err, res) => {
      if (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      }
      console.log(
        argv._[0].grey +
          ' seeded services: '.green +
          res
            .filter(doc => doc['@type'] === 'Service')
            .map(doc => `${doc['@id']} (${doc.name})`)
            .join('; ')
      );
      process.exit(0);
    });
    break;
  }

  case 'delete':
    deleteId(argv.i, config, (err, itemList) => {
      if (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      } else {
        console.error(
          argv._[0].grey +
            ' - '.red +
            ` Deleted ${arrayify(itemList.numberOfItems).length} nodes`
        );
        console.log(itemList);
        process.exit(0);
      }
    });
    break;

  case 'delete-stripe-account': {
    const librarian = new Librarian(config);
    librarian.stripe.accounts.del(argv.i, (err, data) => {
      if (err) {
        console.error(argv._[0].grey + ' ERR! '.red + err.message);
        process.exit(1);
      } else {
        console.log(argv._[0].grey + ' - '.green + argv.i);
        process.exit(0);
      }
    });
    break;
  }

  case 'subscribe': {
    const librarian = new Librarian(config);
    const userId = `user:${argv.u}`;
    const organizationId = argv.o;
    const offerId = {
      free: SCIPE_FREE_OFFER_ID,
      explorer: SCIPE_EXPLORER_OFFER_ID,
      voyager: SCIPE_VOYAGER_OFFER_ID
    }[argv.plan];

    librarian.post(
      {
        '@type': 'SubscribeAction',
        agent: userId,
        instrument: organizationId,
        actionStatus: 'ActiveActionStatus',
        expectsAcceptanceOf: offerId,
        object: 'service:scipe'
      },
      { acl: userId, skipPayments: true },
      (err, data) => {
        if (err) {
          console.error(argv._[0].grey + ' ERR! '.red + err.message);
          process.exit(1);
        } else {
          console.log(
            argv._[0].grey + ': '.green + argv.o + ' (' + offerId + ')'
          );
          process.exit(0);
        }
      }
    );

    break;
  }

  default: {
    console.log(
      'Invalid command. Run librarian --help for list of available commands and options.'
    );
    process.exit(1);
    break;
  }
}
