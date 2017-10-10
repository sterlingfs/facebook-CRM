const functions = require('firebase-functions');
const verify_token = 'random_string';
const admin = require('firebase-admin');
const https = require('https');

const APP_ID = '272881716530408';
const SECRET = '4e76336ebc8f7ee5c169efe02a1e551a';
const LEADGEN = 'leadgen';

// init app
admin.initializeApp(functions.config().firebase);
const database = admin.database()

// export functions
exports.pageSubscription = functions.https.onRequest((req, res) => {
  switch (req.method) {
    case 'GET':
      return verificationRequests(req, res);
    case 'POST':
      return updateNotification(req, res);
    default:
      return res.status(403).send('Forbidden');
  }
});

// convenience methods
function verificationRequests(req, res) {
  console.log('verification request:', req.query);
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verify_token) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.status(404).send('404 Not Found');
  }
}

function updateNotification(req, res) {
  res.status(200).send('200 OK');
  for (const entry of req.body.entry) {
    for (const change of entry.changes) {
      switch (change.field) {
        case LEADGEN:
          return handleLeadgen(change.value);
        default:
          break;
      }
    }
  }
}

function handleLeadgen(leadgenValue) {
  database.ref('/admin/facebook/accessToken').once('value')
    .then(token => fetchLead(leadgenValue.leadgen_id, token.val()))
    .then(lead => {
      database.ref(`/fbForm/${leadgenValue.form_id}/userId`).once('value')
        .then(uid => {
          // write to database
          const contact = parseFbLead(lead.field_data);
          database.ref(`/contacts/${uid.val()}/${lead.id}`).set(contact);
          // dispatch message
          database.ref(`/users/${uid.val()}`).once('value')
            .then(user => {
              if (user.val().twilio) {
                database.ref(`/twilio/${uid.val()}`).once('value')
                  .then(credential => dispatchTwilioMessage(user.val(), contact, credential.val()))
                  .then(message => database.ref())
              } else {

                // dispatchPlivoMessage(user.val(), contact, credential)

              }
            });
        });
    });
}

function fetchLead(leadgenId, accessToken) {
  let lead = `https://graph.facebook.com/v2.10/${leadgenId}?access_token=${accessToken}`
  let data = '';
  return new Promise(resolve => {
    https.get(lead, (response) => {
      response.on('data', (d) => data += d);
      response.on('end', () => resolve(JSON.parse(data)));
    })
  })
}

function dispatchTwilioMessage(from, to, credential) {
  const {
    account_sid,
    auth_token
  } = credential;
  const client = require('twilio')(account_sid, auth_token);
  console.log('message:', parseMessage(from, to));
  return client.messages.create({ 
    to: to.phone, 
    from: from.phone, 
    body: parseMessage(from, to), 
  });
}

function dispatchPlivoMessage(from, to, credential) {
  const plivo = require('plivo');
  const instance = plivo.RestAPI({
    authId: 'YOUR AUTH_ID',
    authToken: 'YOUR AUTH_TOKEN'
  });
  const params = {
    'src': from.phone,
    'dst': to.phone,
    'text': parseMessage(from, to)
  };
  // UNCOMMNET THIS BLOCK WHEN READY FOR PRODUCTION
  // instance.send_message(params, (status, response) => {
  //     console.log('Plivo status:', status);
  //     console.log('Plivo API Response:', response);
  // });
}

function parseFbLead(fieldData) {
  return {
    email: fieldData[0].values[0],
    Purpose: fieldData[1].values[0],
    last_name: fieldData[2].values[0],
    phone: fieldData[3].values[0],
    first_name: fieldData[4].values[0]
  }
}

function parseMessage(from, to) {
  return `Hi ${to.first_name}, this is ${from.first_name} ${from.last_name} ${from.title ? `the ${from.title} on Facebook` : 'from Facebook'}. Thank you for responding to my Facebook Ad. When is a good time to chat?`
}
