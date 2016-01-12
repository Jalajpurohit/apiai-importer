const _ = require('lodash');
const async = require('async');
const conf = require('./conf');
const fs = require('fs');
const parse = require('csv-parse');
const request = require('request');
const through = require('through');
const util = require('util')

const csvFilePath = process.argv[2];
const csvFile = fs.createReadStream(csvFilePath);

const parser = parse({
  columns() {
    return ['url', 'statement', 'synonyms', 'topic', 'data', 'answer', 'outputContext', 'inputContext', 'link', 'additionalInfo'];
  }
});

const clean = through(function (data) {
  if (!data.topic || !data.answer || !data.statement) return;
  const synonyms = data.synonyms ? data.synonyms.split(';') : []
  const trueData = {
    inputs: [data.statement].concat(synonyms),
    outputContexts: data.outputContext ? [data.outputContext] : [],
    inputContexts: data.inputContext ? [data.inputContext] : [],
    topic: data.topic,
    answer: data.answer
  }

  this.queue(trueData)
});

const push = through(function (data) {
  const body = {
    name: data.topic,
    auto: true,
    templates: data.inputs,
    contexts: data.inputContexts,
    responses: [{
      resetContexts: !data.outputContexts.length,
      affectedContexts: data.outputContexts,
      parameters: [],
      speech: [data.answer]
    }]
  }

  console.log(`    Importing ${data.topic}`)

  apiCall('intents', {method: 'POST', body}, (err, res) => {
    if (err) {
      console.error(err)
    } else {
      console.log(`    Imported ${data.topic} as ${res.id}`)
    }
  })
})

function apiCall(endpoint, options, done) {
  request({
    url: `https://api.api.ai/v1/${endpoint}`,
    method: options.method || 'GET',
    qs: {v: '20150910'},
    body: options.body,
    json: true,
    auth: {bearer: conf.apiai.access_token},
    headers: {'ocp-apim-subscription-key': conf.apiai.subscription_key}
  }, (err, response, body) => {
    if (err) {
      done(err)
    } else {
      done(null, body)
    }
  })
}

function clearIntents(done) {
  console.log('** Deleting All Intents **')
  apiCall('intents', {}, (err, res) => {
    if (err) {
      console.error(err)
    } else {
      async.each(res, (item, done) => {
        console.log(`    Deleting ${item.name}`)
        apiCall(`intents/${item.id}`, {method: 'DELETE'}, (err) => {
          if (err) {
            done(err)
          } else {
            console.log(`    Deleted ${item.name}`)
            done(null)
          }
        })
      }, done)
    }
  })
}

clearIntents((err) => {
  if (err) {
    console.error(err)
  } else {
    console.log('** Importing Intents **')
    csvFile
      .pipe(parser)
      .pipe(clean)
      .pipe(push)
  }
})
