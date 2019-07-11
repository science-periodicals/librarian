import util from 'util';
import asyncEachSeries from 'async/eachSeries';
import asyncWhilst from 'async/whilst';
import colors from 'colors'; // eslint-disable-line
import { arrayify } from '@scipe/jsonld';
import { Librarian } from '../..';

/* eslint-disable no-console */

const MAX_RETRY = 5;

export default function processStory(cmd, story, config, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  const { verbose = false } = opts || {};

  const librarian = new Librarian(
    Object.assign({ skipPayments: true, skipDoiRegistration: true }, config)
  );

  const actions = arrayify(story);

  const start = opts.start != null ? opts.start : 0;
  const end = opts.end != null ? opts.end : actions.length;

  const actionsToRun = actions.slice(start, end);

  console.log(
    cmd.grey +
      ` processing ${actionsToRun.length} action${
        actionsToRun.length > 1 ? 's' : ''
      } (${start} -> ${end})`
  );

  let i = start;
  asyncEachSeries(
    actionsToRun,
    (action, cb) => {
      console.log(
        cmd.grey +
          ' POSTing ' +
          (action['@type'] || '').magenta +
          ` (${i++}/${actions.length}):`
      );
      if (verbose) {
        console.log(util.inspect(action, { depth: null }));
      }

      // we try MAX_RETRY times to POST and give up
      let n = 0;
      asyncWhilst(
        () => {
          return n < MAX_RETRY;
        },
        cb => {
          n++;
          librarian.post(
            action,
            {
              strict: false,
              isRetrying: n > 1, // needed so that validation is skipped on retries
              acl: false,
              rpc: true,
              addTriggeredActionToResult: true
            },
            (err, handledActions) => {
              if (err) {
                if (n < MAX_RETRY) {
                  console.error(
                    cmd.grey +
                      ' error '.red +
                      err.message +
                      ` \nretrying... (${n} / ${MAX_RETRY - 1})`
                  );

                  setTimeout(() => {
                    cb(null, handledActions);
                  }, 1000 * n);
                } else {
                  cb(err);
                }
              } else {
                n = Number.POSITIVE_INFINITY;
                cb(null, handledActions);
              }
            }
          );
        },
        (err, handledActions) => {
          if (err) {
            if (!verbose) {
              console.error('error on step ${i-1}:');
              console.error(util.inspect(action, { depth: null }));
            }
            return cb(err);
          }

          const [handledAction, ...triggeredActions] = handledActions;

          if (verbose) {
            console.log(cmd.grey + ' -> '.green);
            console.log(util.inspect(handledAction, { depth: null }));
            if (triggeredActions.length) {
              console.log('\n ' + 'triggered'.yellow + ':\n');
              console.log(util.inspect(triggeredActions, { depth: null }));
            }
            console.log(
              '\n             =====================             \n'.grey
            );
          } else {
            console.log(' -> OK');
          }
          cb(null);
        }
      );
    },
    err => {
      if (err) {
        console.error(
          cmd.grey + ' ERR! '.red + ` (step ${i - 1}) ` + err.message
        );
        console.error(err);
        err.retryIndex = i - 1;
        return callback(err);
      }

      console.log(
        cmd.grey +
          ' ✓ '.green +
          ` ${actionsToRun.length} action${
            actionsToRun.length > 1 ? 's' : ''
          } (${start} -> ${end})`
      );
      callback(null);
    }
  );
}
