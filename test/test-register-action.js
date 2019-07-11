import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

describe('RegisterAction', function() {
  this.timeout(40000);

  let user;
  const librarian = new Librarian({ skipPayments: true });

  describe('strict mode', () => {
    before(async () => {
      user = await registerUser();
    });

    it('should have created a user with profile on register', () => {
      assert(user);
    });

    it('should not allow user to issue an active RegisterAction with an existing userId', async () => {
      let err;
      try {
        await librarian.post({
          '@type': 'RegisterAction',
          actionStatus: 'ActiveActionStatus',
          agent: {
            '@id': getId(user),
            email: `mailto:success+${uuid.v4()}@simulator.amazonses.com`
          },
          instrument: {
            '@type': 'Password',
            value: uuid.v4()
          }
        });
      } catch (_err) {
        err = _err;
      }
      assert.equal(err && err.code, 423);
    });

    it('should not allow user to issue an active RegisterAction with an existing email', async () => {
      let err;
      try {
        await librarian.post({
          '@type': 'RegisterAction',
          actionStatus: 'ActiveActionStatus',
          agent: {
            '@id': `user:${uuid.v4()}`,
            email: user.email
          },
          instrument: {
            '@type': 'Password',
            value: uuid.v4()
          }
        });
      } catch (_err) {
        err = _err;
      }
      assert.equal(err && err.code, 423);
    });

    it('should have access to the registration token and actionId in an email', async () => {
      const user = {
        '@id': `user:${uuid.v4()}`,
        email: `mailto:success+${uuid.v4()}@simulator.amazonses.com`
      };
      const registerAction = await librarian.post({
        '@type': 'RegisterAction',
        actionStatus: 'ActiveActionStatus',
        agent: user,
        instrument: {
          '@type': 'Password',
          value: uuid.v4()
        },
        potentialAction: {
          '@type': 'InformAction',
          agent: 'bot:scienceai',
          recipient: user,
          actionStatus: 'CompletedActionStatus',
          instrument: {
            '@type': 'EmailMessage',
            description: 'hello',
            text: {
              '@type': 'sa:ejs',
              '@value':
                '<p><%= getId(locals.registrationToken) %> <%= getId(locals.object) %></p>'
            }
          }
        }
      });

      // console.log(require('util').inspect(registerAction, { depth: null }));

      assert(
        arrayify(registerAction.potentialAction).some(
          action =>
            action.instrument &&
            action.instrument.text &&
            action.instrument.text['@value'] &&
            action.instrument.text['@value'].includes('token:')
        )
      );

      assert(
        arrayify(registerAction.potentialAction).some(
          action =>
            action.instrument &&
            action.instrument.text &&
            action.instrument.text['@value'] &&
            action.instrument.text['@value'].includes(getId(registerAction))
        )
      );
    });
  });

  describe('non strict mode', () => {
    it('should register a user in 1 pass', async () => {
      const registerAction = await librarian.post(
        {
          '@type': 'RegisterAction',
          actionStatus: 'CompletedActionStatus',
          agent: {
            '@id': `user:${uuid.v4()}`,
            '@type': 'Person',
            email: `mailto:test+${uuid.v4()}@science.ai`
          },
          instrument: {
            '@type': 'Password',
            value: 'pass'
          },
          object: 'https://science.ai'
        },
        { strict: false }
      );

      assert(registerAction['@id']);
    });
  });
});
